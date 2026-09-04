using Mono.Cecil;
using Mono.Cecil.Cil;

// Patches The Long Drive's mirror render cap.
// mainscript.MirrorsUpdate sorts all mirrors nearest-first, then kills every
// mirror at index >= N (Turn off -> noMirrorMaterial). Vanilla N = 5.
// Usage: MirrorPatch <Assembly-CSharp.dll> [newCap]
// Default newCap = 20. Prints what it changed; exits non-zero on failure.
var dllPath = args.Length > 0 ? args[0] : throw new Exception("usage: MirrorPatch <Assembly-CSharp.dll> [newCap]");
var newCap = args.Length > 1 ? int.Parse(args[1]) : 20;
if (newCap is < 1 or > 120) throw new Exception("newCap must be 1..120");

var resolver = new DefaultAssemblyResolver();
resolver.AddSearchDirectory(Path.GetDirectoryName(Path.GetFullPath(dllPath))!);
if (args.Length > 2) resolver.AddSearchDirectory(args[2]); // e.g. game's Managed dir
var asm = AssemblyDefinition.ReadAssembly(dllPath, new ReaderParameters { AssemblyResolver = resolver });
var mainscript = asm.MainModule.Types.First(t => t.Name == "mainscript");
var method = mainscript.Methods.First(m =>
    m.Name == "MirrorsUpdate" && m.Parameters.Count == 3); // (_mirrorHeadPos, _cam, _depth)

var patched = 0;
var il = method.Body.Instructions;
for (var i = 0; i < il.Count - 2; i++)
{
    // pattern for `if (j >= N)`: ldloc j, ldc.i4 N, blt[.s] skip
    if (!IsLdloc(il[i])) continue;
    var ld = il[i + 1];
    if (!IsLdcI4(ld, out var val)) continue;
    var br = il[i + 2];
    if (br.OpCode != OpCodes.Blt && br.OpCode != OpCodes.Blt_S
        && br.OpCode != OpCodes.Blt_Un && br.OpCode != OpCodes.Blt_Un_S) continue;
    Console.WriteLine($"found cap check at IL_{il[i].Offset:X4}: j >= {val} -> j >= {newCap}");
    ld.OpCode = OpCodes.Ldc_I4_S;
    ld.Operand = (sbyte)newCap;
    patched++;
}

if (patched == 0) throw new Exception("cap pattern not found - assembly differs from v2024.11.26b?");
if (patched > 1) throw new Exception($"ambiguous: {patched} matches - refusing to patch");

var tmp = dllPath + ".patched-tmp";
asm.Write(tmp);
asm.Dispose();
File.Copy(tmp, dllPath, overwrite: true);
File.Delete(tmp);
Console.WriteLine($"patched OK: mirror cap is now {newCap} (backup your .dll first!)");

static bool IsLdloc(Instruction ins) =>
    ins.OpCode == OpCodes.Ldloc_0 || ins.OpCode == OpCodes.Ldloc_1 ||
    ins.OpCode == OpCodes.Ldloc_2 || ins.OpCode == OpCodes.Ldloc_3 ||
    ins.OpCode == OpCodes.Ldloc || ins.OpCode == OpCodes.Ldloc_S;

static bool IsLdcI4(Instruction ins, out int val)
{
    val = 0;
    switch (ins.OpCode.Code)
    {
        case Code.Ldc_I4_0: case Code.Ldc_I4_1: case Code.Ldc_I4_2:
        case Code.Ldc_I4_3: case Code.Ldc_I4_4: case Code.Ldc_I4_5:
        case Code.Ldc_I4_6: case Code.Ldc_I4_7: case Code.Ldc_I4_8:
            val = ins.OpCode.Code - Code.Ldc_I4_0; return true;
        case Code.Ldc_I4_S: val = (sbyte)ins.Operand; return true;
        case Code.Ldc_I4: val = (int)ins.Operand; return true;
        default: return false;
    }
}
