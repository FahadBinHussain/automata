"""trash-files.py - move explicit files to the Recycle Bin (never permanent delete).

usage:  python trash-files.py <path> [<path> ...]
        or --list <utf8-file>   (bengali names must not travel through cmd's codepage)

why SHFileOperationW and not send2trash: send2trash's windows backend passes the path
through the ANSI shell API, so any non-ASCII name fails with FileNotFoundError even
though the file exists (hit 2026-10-26 on bengali filenames). SHFileOperationW takes
a wide-char double-null-terminated list and handles unicode correctly.

FOF_ALLOWUNDO = recycle bin (recoverable), no confirmation dialogs.
prints one line per path, then a summary. exit 2 if anything failed.
"""
import ctypes
import pathlib
import sys
from ctypes import wintypes

FO_DELETE = 3
FOF_SILENT = 0x0004
FOF_NOCONFIRMATION = 0x0010
FOF_ALLOWUNDO = 0x0040
FOF_NOERRORUI = 0x0400


class SHFILEOPSTRUCTW(ctypes.Structure):
    _fields_ = [
        ("hwnd", wintypes.HWND),
        ("wFunc", wintypes.UINT),
        ("pFrom", wintypes.LPCWSTR),
        ("pTo", wintypes.LPCWSTR),
        ("fFlags", ctypes.c_uint16),
        ("fAnyOperationsAborted", wintypes.BOOL),
        ("hNameMappings", ctypes.c_void_p),
        ("lpszProgressTitle", wintypes.LPCWSTR),
    ]


def to_recycle_bin(path: str) -> int:
    # pFrom must be double-null terminated
    op = SHFILEOPSTRUCTW(
        hwnd=None,
        wFunc=FO_DELETE,
        pFrom=path + "\0",
        pTo=None,
        fFlags=FOF_ALLOWUNDO | FOF_NOCONFIRMATION | FOF_SILENT | FOF_NOERRORUI,
        fAnyOperationsAborted=False,
        hNameMappings=None,
        lpszProgressTitle=None,
    )
    return ctypes.windll.shell32.SHFileOperationW(ctypes.byref(op))


def main() -> int:
    args = sys.argv[1:]
    if args and args[0] == "--list":
        args = [ln.strip() for ln in pathlib.Path(args[1]).read_text(encoding="utf-8").splitlines() if ln.strip()]
    if not args:
        print("usage: trash-files.py <path>... | --list <file>", file=sys.stderr)
        return 1

    ok = skip = fail = 0
    for a in args:
        p = pathlib.Path(a)
        if not p.exists():
            print("SKIP    missing: %s" % p.name)
            skip += 1
            continue
        size = p.stat().st_size if p.is_file() else 0
        rc = to_recycle_bin(str(p.resolve()))
        if rc == 0 and not p.exists():
            print("TRASHED %10d  %s" % (size, p.name))
            ok += 1
        else:
            print("FAIL    rc=%d still-present=%s  %s" % (rc, p.exists(), p.name))
            fail += 1
    print("SUMMARY trashed=%d skipped=%d failed=%d" % (ok, skip, fail))
    return 0 if fail == 0 else 2


if __name__ == "__main__":
    sys.exit(main())
