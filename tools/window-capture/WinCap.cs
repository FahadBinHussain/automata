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
    [DllImport("user32.dll")] static extern int GetWindowText(IntPtr h, StringBuilder s, int max);
    [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
    [DllImport("user32.dll", CharSet=CharSet.Auto)] static extern IntPtr FindWindow(string c, string n);
    [DllImport("user32.dll")] static extern bool EnumChildWindows(IntPtr h, EnumWindowsProc cb, IntPtr l);
    [DllImport("user32.dll")] static extern IntPtr GetWindow(IntPtr h, uint cmd);
    delegate bool EnumWindowsProc(IntPtr h, IntPtr l);

    [StructLayout(LayoutKind.Sequential)]
    struct RECT { public int Left, Top, Right, Bottom; }

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
        if (pidOk && titleOk && hwndOk && t.Length > 0) {
            foundHwnd = h;
            return false;
        }
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

        RECT r;
        GetWindowRect(foundHwnd, out r);
        int w = r.Right - r.Left, h = r.Bottom - r.Top;
        Console.WriteLine("outer rect=" + w + "x" + h);
        if (w <= 0 || h <= 0) { Console.WriteLine("Empty rect"); return; }

        using (var bmp = new Bitmap(w, h)) {
            using (var g = Graphics.FromImage(bmp)) {
                var hdc = g.GetHdc();
                PrintWindow(foundHwnd, hdc, 2); // PW_RENDERFULLCONTENT
                g.ReleaseHdc(hdc);
            }
            bmp.Save(outPath, ImageFormat.Png);
            Console.WriteLine("captured hwnd=" + foundHwnd + " out=" + outPath);
        }
    }
}
