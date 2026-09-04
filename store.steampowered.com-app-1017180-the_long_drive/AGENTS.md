# thelongdrive - mirror cap patch

raises the mirror render cap in The Long Drive (`mainscript.MirrorsUpdate` sorts
all mirrors nearest-first, then kills every mirror at index >= N).

- vanilla N = 5 (v2024.11.26b verified via ilspycmd decompile)
- patched N = 20

## run

```pwsh
dotnet run --project mirror-cap-patch -c Release -- "<game>\TheLongDrive_Data\Managed\Assembly-CSharp.dll" 20
```

- arg 3 (optional): extra assembly search dir, e.g. the game's `Managed` folder
  (needed when patching a copy outside the install; skips UnityEngine resolve errors)
- needs dotnet SDK + nuget (Mono.Cecil). needs .NET 6+ runtime for ilspycmd only.
- backup your dll first. original kept at `Assembly-CSharp.dll.bak-orig` next to it.
- verify after: `ilspycmd -t mainscript <dll>` should show `if (j >= 20)`.
- re-apply after every game update/reinstall (update overwrites the dll).

## perf note

each rendering mirror = one full extra scene render (`Camera.Render()` per mirror
per frame). 20 mirrors costs real fps. if fps tanks, lower the cap or fit fewer
mirrors. `FMirrorDrawDistance` (settings.tldc, default 100.0) still gates range;
`BMirrors` is the master toggle.

## gotchas

- Mono.Cecil write needs UnityEngine.* resolvable: patch the dll in place inside
  `Managed` (deps sit next to it), or pass the Managed dir as arg 3.
- Cecil holds the input file open on read: patcher writes to a `.patched-tmp`
  file then copies over (avoids file-lock crash).
- ilspycmd 8.x needs `DOTNET_ROLL_FORWARD=LatestMajor` when only .NET 8 runtime
  is installed (it asks for .NET 6).
- mirrors beyond the cap show `noMirrorMaterial` (dark/purple); reflection is
  computed from player head pos, so drop-cams show stale angles (engine design,
  not fixable by this patch).
