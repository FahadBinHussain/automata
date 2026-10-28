using System;
using System.Diagnostics;
using System.Drawing;
using System.Drawing.Imaging;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;

class WinCap {
    [DllImport("user32.dll")] static extern bool GetWindowRect(IntPtr h, out RECT r);
    [DllImport("user32.dll")] static extern bool PrintWindow(IntPtr h, IntPtr hdc, int flags);
    [DllImport("user32.dll")] static extern bool EnumWindows(EnumWindowsProc cb, IntPtr l);
    [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr h);
    [DllImport("user32.dll")] static extern bool IsIconic(IntPtr h);
    [DllImport("user32.dll")] static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll")] static extern bool GetWindowPlacement(IntPtr h, ref WINDOWPLACEMENT p);
    [DllImport("user32.dll")] static extern int GetWindowText(IntPtr h, StringBuilder s, int max);
    [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
    [DllImport("user32.dll", CharSet=CharSet.Auto)] static extern IntPtr FindWindow(string c, string n);
    [DllImport("user32.dll")] static extern bool EnumChildWindows(IntPtr h, EnumWindowsProc cb, IntPtr l);
    [DllImport("user32.dll")] static extern IntPtr GetWindow(IntPtr h, uint cmd);
    [DllImport("user32.dll", CharSet=CharSet.Unicode, SetLastError=true)] static extern IntPtr CreateWindowEx(int exStyle, string cls, string name, int style, int x, int y, int w, int h, IntPtr parent, IntPtr menu, IntPtr inst, IntPtr param);
    [DllImport("user32.dll")] static extern bool DestroyWindow(IntPtr h);
    [DllImport("user32.dll")] static extern bool SetWindowPos(IntPtr h, IntPtr after, int x, int y, int cx, int cy, uint flags);
    [DllImport("user32.dll")] static extern bool PeekMessage(out MSG m, IntPtr h, uint min, uint max, uint remove);
    [DllImport("user32.dll")] static extern bool TranslateMessage(ref MSG m);
    [DllImport("user32.dll")] static extern IntPtr DispatchMessage(ref MSG m);
    [DllImport("dwmapi.dll")] static extern int DwmRegisterThumbnail(IntPtr dest, IntPtr src, out IntPtr thumb);
    [DllImport("dwmapi.dll")] static extern int DwmUnregisterThumbnail(IntPtr thumb);
    [DllImport("dwmapi.dll")] static extern int DwmUpdateThumbnailProperties(IntPtr thumb, ref THUMBNAILPROPS p);
    delegate bool EnumWindowsProc(IntPtr h, IntPtr l);

    [StructLayout(LayoutKind.Sequential)]
    struct RECT { public int Left, Top, Right, Bottom; }

    [StructLayout(LayoutKind.Sequential)]
    struct POINT { public int X, Y; }

    [StructLayout(LayoutKind.Sequential)]
    struct WINDOWPLACEMENT {
        public int length; public int flags; public int showCmd;
        public POINT ptMinPosition; public POINT ptMaxPosition;
        public RECT rcNormalPosition; public RECT rcDevice;
    }

    [StructLayout(LayoutKind.Sequential)]
    struct MSG {
        public IntPtr hwnd; public uint message; public IntPtr wParam;
        public IntPtr lParam; public uint time; public POINT pt;
    }

    // DWM_THUMBNAIL_PROPERTIES — DwmQueryThumbnailProperties is NOT exported
    // on this system (GetProcAddress miss), so we never set TNP_RECTSOURCE:
    // DWM then uses the whole window as source, which is what we want.
    [StructLayout(LayoutKind.Sequential)]
    struct THUMBNAILPROPS {
        public int dwFlags; public RECT rcDestination; public RECT rcSource;
        public byte opacity;
        [MarshalAs(UnmanagedType.Bool)] public bool visible;
        [MarshalAs(UnmanagedType.Bool)] public bool clientAreaOnly;
    }

    const int TNP_RECTDESTINATION = 0x1;
    const int TNP_OPACITY = 0x4;
    const int TNP_VISIBLE = 0x8;
    const int WS_VISIBLE = 0x10000000;
    const int WS_POPUP = unchecked((int)0x80000000);
    const int WS_EX_TOOLWINDOW = 0x80;
    const int WS_EX_NOACTIVATE = 0x08000000;
    const uint SWP_NOSIZE = 0x1;
    const uint SWP_NOACTIVATE = 0x10;
    static readonly IntPtr HWND_BOTTOM = new IntPtr(1);

    static IntPtr foundHwnd = IntPtr.Zero;
    static IntPtr targetHwnd = IntPtr.Zero;
    static uint targetPid = 0;
    static string titleMatch = "";

    static bool Callback(IntPtr h, IntPtr l) {
        if (!IsWindowVisible(h)) return true;
        uint p;
        GetWindowThreadProcessId(h, out p);

        var sb = new StringBuilder(256);
        GetWindowText(h, sb, 256);
        string t = sb.ToString();

        bool pidOk = (targetPid == 0) || (p == targetPid);
        bool titleOk = (titleMatch.Length == 0) || (t.IndexOf(titleMatch, StringComparison.OrdinalIgnoreCase) >= 0);
        bool hwndOk = (targetHwnd == IntPtr.Zero) || (h == targetHwnd);
        // empty-title windows (e.g. Shell_TrayWnd) are only reachable through an
        // explicit hwnd — title/pid searches keep the non-empty-title guard so they
        // don't latch onto invisible helper windows
        if (pidOk && titleOk && hwndOk && (t.Length > 0 || targetHwnd != IntPtr.Zero)) {
            foundHwnd = h;
            return false;
        }
        return true;
    }

    // pump our own message queue so DWM can composite the thumbnail into dest
    static void Pump(int ms) {
        int end = Environment.TickCount + ms;
        MSG m;
        while (Environment.TickCount < end) {
            while (PeekMessage(out m, IntPtr.Zero, 0, 0, 1)) {
                TranslateMessage(ref m);
                DispatchMessage(ref m);
            }
            System.Threading.Thread.Sleep(16);
        }
    }

    static void SaveBitmap(IntPtr hwnd, int w, int h, string outPath) {
        using (var bmp = new Bitmap(w, h)) {
            using (var g = Graphics.FromImage(bmp)) {
                var hdc = g.GetHdc();
                PrintWindow(hwnd, hdc, 2); // PW_RENDERFULLCONTENT
                g.ReleaseHdc(hdc);
            }
            bmp.Save(outPath, ImageFormat.Png);
        }
    }

    // uniformity check on a 32px grid: a blank dest render has no spread
    static bool LooksBlank(string path) {
        using (var bmp = (Bitmap)Bitmap.FromFile(path)) {
            int min = 255, max = 0;
            for (int x = 0; x < bmp.Width; x += 32)
                for (int y = 0; y < bmp.Height; y += 32) {
                    Color c = bmp.GetPixel(x, y);
                    int lum = (c.R * 30 + c.G * 59 + c.B * 11) / 100;
                    if (lum < min) min = lum;
                    if (lum > max) max = lum;
                }
            return (max - min) < 16;
        }
    }

    // minimized window: content has no surface, so PrintWindow returns blank.
    // snap it through a DWM thumbnail rendered into OUR OWN off-screen dest
    // window — the target is never restored, never activated, stays minimized
    // and the foreground window is asserted unchanged.
    static bool CaptureMinimized(IntPtr src, int w, int h, string outPath) {
        Console.WriteLine("method=DWM thumbnail snap (target stays minimized, never restored/activated)");
        IntPtr fg0 = GetForegroundWindow();

        IntPtr dest = CreateWindowEx(WS_EX_TOOLWINDOW | WS_EX_NOACTIVATE, "STATIC", "",
            WS_VISIBLE | WS_POPUP, -30000, -30000, w, h,
            IntPtr.Zero, IntPtr.Zero, IntPtr.Zero, IntPtr.Zero);
        if (dest == IntPtr.Zero) {
            Console.WriteLine("ERROR: off-screen dest window creation failed win32=" + Marshal.GetLastWin32Error());
            return false;
        }
        try {
            SetWindowPos(dest, HWND_BOTTOM, -30000, -30000, 0, 0, SWP_NOSIZE | SWP_NOACTIVATE);
            Pump(200);

            IntPtr thumb;
            int hr = DwmRegisterThumbnail(dest, src, out thumb);
            if (hr != 0) {
                Console.WriteLine("ERROR: DwmRegisterThumbnail failed hr=0x" + hr.ToString("X8"));
                return false;
            }
            try {
                THUMBNAILPROPS p = new THUMBNAILPROPS();
                p.dwFlags = TNP_RECTDESTINATION | TNP_OPACITY | TNP_VISIBLE;
                p.rcDestination.Left = 0; p.rcDestination.Top = 0;
                p.rcDestination.Right = w; p.rcDestination.Bottom = h;
                p.opacity = 255;
                p.visible = true;
                p.clientAreaOnly = false;
                hr = DwmUpdateThumbnailProperties(thumb, ref p);
                if (hr != 0) {
                    Console.WriteLine("ERROR: DwmUpdateThumbnailProperties failed hr=0x" + hr.ToString("X8"));
                    return false;
                }
                Pump(500);
                SaveBitmap(dest, w, h, outPath);
            } finally {
                DwmUnregisterThumbnail(thumb);
            }
        } finally {
            DestroyWindow(dest);
        }

        long bytes = new FileInfo(outPath).Length;
        bool blank = LooksBlank(outPath);
        Console.WriteLine("out=" + outPath + " bytes=" + bytes + (blank ? " UNIFORM" : ""));
        if (blank) {
            Console.WriteLine("ERROR: DWM thumbnail capture came back blank (thumbnail did not render)");
            return false;
        }

        IntPtr fg1 = GetForegroundWindow();
        bool preserved = (fg0 == fg1);
        Console.WriteLine("focus preserved=" + preserved + " target still minimized=" + IsIconic(src));
        if (!preserved) {
            Console.WriteLine("ERROR: foreground window changed during capture");
            return false;
        }
        Console.WriteLine("captured hwnd=" + src + " out=" + outPath);
        return true;
    }

    static void Main(string[] args) {
        if (args.Length < 1) { Console.WriteLine("usage: WinCap <ProcessName|pid|hwnd:0xHEX|*> [titleMatch] [out.png]"); return; }
        string firstArg = args[0];
        titleMatch = (args.Length > 1) ? args[1] : "";
        string outPath = (args.Length > 2) ? args[2] : Path.Combine(Path.GetTempPath(), "wincap_out.png");

        if (firstArg.StartsWith("hwnd:")) {
            // direct HWND mode — works for UWP and any window
            string hex = firstArg.Substring(5);
            if (hex.StartsWith("0x") || hex.StartsWith("0X")) hex = hex.Substring(2);
            targetHwnd = (IntPtr)long.Parse(hex, System.Globalization.NumberStyles.HexNumber);
            EnumWindows(Callback, IntPtr.Zero);
        } else if (firstArg == "*" || firstArg == "") {
            // title-only search across all processes — UWP windows are hosted by
            // ApplicationFrameHost so ProcessName-based lookup misses them
            EnumWindows(Callback, IntPtr.Zero);
        } else {
            string procName = firstArg.TrimEnd(".exe".ToCharArray());
            foreach (var pr in Process.GetProcessesByName(procName)) {
                targetPid = (uint)pr.Id;
                foundHwnd = IntPtr.Zero;
                EnumWindows(Callback, IntPtr.Zero);
                if (foundHwnd != IntPtr.Zero) break;
            }
        }

        if (foundHwnd == IntPtr.Zero) {
            Console.WriteLine("No matching window found");
            return;
        }

        if (IsIconic(foundHwnd)) {
            // minimized: GetWindowRect would give the -32000 iconified rect and
            // PrintWindow renders blank — size the snap from the restored size
            WINDOWPLACEMENT wp = new WINDOWPLACEMENT();
            wp.length = Marshal.SizeOf(typeof(WINDOWPLACEMENT));
            if (!GetWindowPlacement(foundHwnd, ref wp)) {
                Console.WriteLine("ERROR: GetWindowPlacement failed for minimized window");
                Environment.Exit(1);
            }
            int nw = wp.rcNormalPosition.Right - wp.rcNormalPosition.Left;
            int nh = wp.rcNormalPosition.Bottom - wp.rcNormalPosition.Top;
            Console.WriteLine("target minimized, normal size=" + nw + "x" + nh);
            if (nw <= 0 || nh <= 0) {
                Console.WriteLine("ERROR: minimized window has no usable normal size (" + nw + "x" + nh + ")");
                Environment.Exit(1);
            }
            if (!CaptureMinimized(foundHwnd, nw, nh, outPath)) Environment.Exit(1);
            return;
        }

        RECT r;
        GetWindowRect(foundHwnd, out r);
        int w = r.Right - r.Left, h = r.Bottom - r.Top;
        Console.WriteLine("outer rect=" + w + "x" + h);
        if (w <= 0 || h <= 0) { Console.WriteLine("Empty rect"); Environment.Exit(1); }

        SaveBitmap(foundHwnd, w, h, outPath);
        Console.WriteLine("captured hwnd=" + foundHwnd + " out=" + outPath);
    }
}
