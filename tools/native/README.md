# CHD and RVZ patching tools

CHD (chdman) and RVZ/WIA/GCZ/WBFS (dolphin-tool) games are patched by unpacking them with the real
tools, patching the plain image, and packing the result again. The app does this automatically
when these two files are present in the build:

    app/src/main/jniLibs/arm64-v8a/libchdman.so
    app/src/main/jniLibs/arm64-v8a/libdolphintool.so

Without them the app still patches BIN/CUE, ISO and CSO games, and tells the person how to
convert a CHD or RVZ first.

`build-chdman.sh` and `build-dolphin-tool.sh` are Joey's (JoeyOS) scripts for producing those two
binaries from the official MAME and Dolphin sources, used with his permission. Both programs are
GPL-2.0 (texts in `/licences`). They run as separate programs, so they don't change the licence of
the rest of the app, but if you ship them, keep the licence texts and a pointer to the source
(the official MAME and Dolphin repositories, at the commits named in the scripts).
