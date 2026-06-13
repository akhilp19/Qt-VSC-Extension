# Qt C++ Tools for VS Code

A comprehensive VS Code extension that brings Qt Creator's essential features to Visual Studio Code, making it Qt C++ developer-friendly on Windows.

## Features

### 🔨 Build System Integration
- **Auto-detect Qt Projects**: Automatically finds `.pro` (QMake), `CMakeLists.txt` (CMake), Python Qt, and raw C++ Qt projects
- **Build Commands**: Build, Clean, Rebuild, Quick Build, and Run your Qt projects with a single command
- **Parallel Builds**: Auto-detects `jom` for MSVC; configurable job count for make/MinGW
- **Pre/Post Build Hooks**: Configure custom commands to run before and after every build

### 🧰 Qt Installation & Toolchain
- **Auto-detection**: Finds Qt via `QTDIR`, PATH, common install directories, and package managers
- **Package Manager Support**: Homebrew, APT, Pacman, vcpkg, Conan, aqtinstall
- **Multi-version Switching**: Quick Pick to switch between detected Qt versions
- **Cross-platform**: Windows (MSVC/MinGW), macOS (Clang), Linux (GCC/Clang)

### 🎯 Available Commands

Access these commands via Command Palette (`Ctrl+Shift+P`):

**Build & Run**
- `Qt: Build Project` — Build the current Qt project
- `Qt: Quick Build` — Skip reconfiguration if build directory exists
- `Qt: Clean Project` — Clean build artifacts
- `Qt: Rebuild Project` — Clean and rebuild
- `Qt: Run Project` — Run the built executable
- `Qt: Select Build Configuration` — Switch Debug / Release per project

**Qt Asset Integration**
- `Qt: Open in Qt Designer` — Edit `.ui` files in Qt Designer
- `Qt: Validate Resource File` — Validate `.qrc` files
- `Qt: Compile Resource File (rcc)` — Run `rcc` manually
- `Qt: Deploy Application` — Run `windeployqt` / `macdeployqt` / `linuxdeployqt`
- `Qt: Build Android APK` — Build Android APK via `androiddeployqt` (or Gradle wrapper when available)
- `Qt: Build Android AAB` — Build Android App Bundle
- `Qt: Build Android APKS from AAB` — Convert AAB to APKS with `bundletool`
- `Qt: Install Android APKS` — Install APKS on device via `bundletool`
- `Qt: Validate Android Manifest` — Check `AndroidManifest.xml` for common Qt issues
- `Qt: Start Android Logcat` / `Qt: Stop Android Logcat` — Stream device logs in output channel
- Android NDK auto-detection from SDK `ndk/` or `ndk-bundle/` directories
- `Qt: Configure Android SDK` — Set Android SDK/NDK paths
- `Qt: Install Android APK` — Install APK to connected device via `adb`
- `Qt: Build iOS App` — Build iOS app for simulator or device (macOS only)
- `Qt: Select iOS Simulator` — Pick iPhone/iPad simulator from `xcrun simctl`
- `Qt: Run iOS App on Simulator` — Build, install, and launch on selected simulator
- `Qt: Archive iOS App` — `xcodebuild archive` for device distribution
- `Qt: Export iOS IPA` — `xcodebuild -exportArchive` with ExportOptions.plist
- `Qt: Upload iOS IPA to TestFlight` — Upload exported IPA via `xcrun altool`
- `Qt: Take iOS Simulator Screenshot` — Capture simulator screen
- `Qt: Record iOS Simulator Video` / `Qt: Stop Simulator Recording` — Record simulator video
- `Qt: Build for WebAssembly` — Build Qt app for WASM via Emscripten (with source maps in debug, pthread detection)
- `Qt: Configure Emscripten SDK` — Set Emscripten path for WASM builds
- `Qt: Serve WebAssembly Preview` — Start local HTTP server for WASM output

**Build Kits**
- `Qt: Detect Build Kits` — Auto-generate kits from Qt installations
- `Qt: Select Build Kit` — Per-project kit selection
- `Qt: Configure Build Kit` — Edit kit build directory template, extra args, env vars, cross-compile prefix
- `Qt: Configure Kit Toolchain` — Assign CMake toolchain file to a kit
- `Qt: Validate Build Kit` — Verify kit paths, qmake, compiler, toolchain compatibility
- `Qt: Export Build Kits` — Save kit definitions as JSON
- `Qt: Import Build Kits` — Load kit definitions from JSON
- Per-kit build directories with variable substitution
- Kit-specific deploy directories
- Cross-compile prefix support per kit
- Sysroot path support per kit
- CMake toolchain file injection into build tasks
- Workspace default kit fallback
- Yocto SDK auto-detection with sysroot/cross-prefix/toolchain population

**QML Support**
- `Qt: Format QML File` — Format with `qmlformat`
- `Qt: Lint QML File` — Lint with `qmllint` (auto-lint on save)
- `Qt: Preview QML File` — Launch `qmlscene` with the current file
- `Qt: Stop QML Preview` — Stop the running QML preview
- **QML Language Server (`qmlls`)** — Real QML IntelliSense via Qt 6.2+ LSP (completions, diagnostics, hover, rename)
- **Hot reload** — Auto-restart `qmlscene` on QML file save (`qt.qmlPreviewHotReload`)

**Qt C++ Language Server**
- Signal/slot-aware completions inside `connect()` calls
- `SIGNAL()` / `SLOT()` macro go-to-definition
- Find all references across `connect()` calls and `emit` sites
- Rename refactoring for signals, slots, and `Q_PROPERTY`
- Diagnostics: missing `Q_OBJECT`, old-style `connect()` usage
- Quick fixes: add `Q_OBJECT`, modernize `connect()` to function pointers
- Auto-starts a stdio LSP server (`out/qtCppLanguageServer.js`) for C++ files
- Settings: `qt.cppLspEnable`, `qt.cppLspServerPath`, `qt.cppLspDiagnosticsEnable`

**QML-C++ Bridge**
- `Qt: Rebuild QML-C++ Index` — Rebuild cross-language index
- **Go to C++ Definition** (`F12`) from QML property bindings and method calls jumps to the C++ `Q_PROPERTY` / `Q_INVOKABLE` declaration, including inherited properties
- **Find QML Usages from C++** (`Shift+F12`) on `Q_INVOKABLE` / `Q_PROPERTY` finds usages scoped to the correct QML type
- **Rename QML-Registered C++ Class** (`F2`) on a `QML_ELEMENT` class updates all `.qml` instantiations
- **Inheritance-aware navigation** — resolves symbols across the QML type inheritance chain
- **QML_ATTACHED support** — Attached property completions and hover
- **QML Type Inference** — Resolve custom QML types defined in C++ via `QML_ELEMENT` / `QML_SINGLETON`
- **QML Module Support** — Parse `qmldir` files, navigate to imported QML types, auto-configure `QML_IMPORT_PATH`

**Code Generation**
- `Qt: Generate MOC` / `Qt: Generate UIC` / `Qt: Generate RCC` — Manual code generation
- `Qt: Go to Generated Code` (`Alt+G`) — Jump to `moc_*.cpp`, `ui_*.h`, `qrc_*.cpp`
- `Qt: Peek Generated Code` (`Alt+Shift+G`) — Inline peek at generated code
- **Auto-generation on save**: `qt.autoMoc`, `qt.autoUic`, `qt.autoRcc`

**Precompiled Headers (PCH)**
- `Qt: Generate Precompiled Header` — Interactive PCH generation with 50+ Qt headers
- `Qt: Integrate Precompiled Header into Build` — Auto-inject into `.pro` or `CMakeLists.txt`
- `Qt: Configure PCH Compiler Flags` — Direct compiler flag configuration

**Debugger**
- `Qt: Generate Debug Launch Configuration` — Auto-create `launch.json`
- `Qt: Setup Qt Pretty Printers` — GDB/LLDB pretty printers for Qt types
- `Qt: Add Signal/Slot Breakpoint` — Trace signal/slot connections

**Testing**
- Auto-discover Qt Test classes and populate the native Test Explorer
- Auto-discover QML `TestCase` items and run via `qmltestrunner`
- Run and Debug Qt Tests directly from the sidebar

**Internationalization**
- `Qt: Update Translations (lupdate)` / `Qt: Compile Translations (lrelease)`
- `Qt: Open in Qt Linguist` — Edit `.ts` files in Qt Linguist
- Translation progress shown in sidebar with completion percentage

**Qt for Python**
- `Qt: Compile .ui to Python` — `pyside6-uic` / `pyuic5`
- `Qt: Compile .qrc to Python` — `pyside6-rcc` / `pyrcc5`
- `Qt: Open Qt Designer (Python)` — Launch designer for Python bindings

**Build Analytics & Optimization**
- `Qt: Show Build Analytics` — Sidebar with build history, durations, success rates
- **Build regression alerts** — Warning icon when last build is > 1.5x average duration
- **Proactive ccache suggestion** — Auto-suggests enabling ccache after slow builds
- `Qt: Configure ccache/sccache` — Auto-detect and configure compiler cache
- `Qt: Show ccache Stats` — View cache hit/miss statistics
- `Qt: Detect Slow Compilation Targets` — Identify slowest `.cpp` files by complexity
- `Qt: Select CMake Preset` — Use `CMakePresets.json` configure/build presets in tasks
- `Qt: Clear CMake Preset` — Revert to default CMake behavior

**Code Quality**
- `Qt: Run Health Check` — Validate Qt, compiler, debugger, kits, Android/iOS/WASM configs, IntelliSense
- `Qt: Run clazy / clang-tidy on Workspace` — Qt-specific static analysis
- `Qt: Run clazy / clang-tidy on Current File` — Single-file analysis
- **clazy quick fixes** — One-click Code Actions for `clazy-old-style-connect`, `clazy-missing-tr`, and more
- **`.clang-tidy` config detection** — Automatically reads project-level `.clang-tidy` / `_clang-tidy`
- Settings: `qt.clazyEnable`, `qt.clazyChecks`, `qt.clazyOnSave`

**Qt Documentation**
- `Qt: Open Qt Documentation` — Browse local Qt docs in VS Code webview
- Hover fallback to offline docs when available, otherwise online `doc.qt.io`

**Profiling & Diagnostics**
- `Qt: Launch QML Profiler` — Run app with QML debugging and connect Qt Creator
- `Qt: Launch CPU Profiler` — Launch `perf`, `Instruments`, `sample`, or `VTune`
- `Qt: Launch Memory Leak Detector` — Run `valgrind`, `Dr. Memory`, or `leaks`

**CI/CD & Deployment**
- `Qt: Setup CI/CD Pipeline` — Generate GitHub Actions and GitLab CI templates
- `Qt: Generate Installer Framework Config` — Create `config.xml` / `package.xml`
- `Qt: Build Installer` — Run `binarycreator` for `.exe` / `.dmg` / `.run`
- `Qt: Configure Remote Target` — Set host, user, remote path, deploy mode
- `Qt: Deploy to Remote Device` — SCP/RSYNC built artifacts to embedded target
- `Qt: Generate Remote Debug Config` — Create `cppdbg` launch config for GDB/LLDB remote debugging

### ⚙️ Configuration

Configure the extension via VS Code settings (`File > Preferences > Settings` or `Ctrl+,`):

```json
{
  "qt.qmakePath": "",                              // Path to qmake (auto-detected if empty)
  "qt.qtInstallPath": "",                          // Qt installation directory
  "qt.autoDetect": "on",                           // Auto-detect Qt projects
  "qt.buildDirectory": "${workspaceFolder}/build", // Build output directory
  "qt.defaultBuildType": "debug",                  // debug or release
  "qt.makeCommand": "auto",                        // auto, nmake, mingw32-make, jom, or make
  "qt.additionalQMakeArguments": "",              // Extra qmake arguments
  "qt.additionalCMakeArguments": "",              // Extra CMake arguments
  "qt.showBuildOutput": true,                     // Show build output
  "qt.clearOutputBeforeBuild": true,              // Clear terminal before build
  "qt.parallelJobs": 0,                           // Parallel jobs (0 = auto)
  "qt.useCcache": false,                          // Use ccache/sccache
  "qt.qmlFormatOnSave": false,                    // Auto-format QML on save
  "qt.qmlLintOnSave": true,                       // Auto-lint QML on save
  "qt.qmlPreviewHotReload": false,                // Restart qmlscene on QML save
  "qt.qmlCppBridgeEnabled": true,                 // Enable QML-C++ bridge
  "qt.autoMoc": false,                            // Auto-run moc on header save
  "qt.autoUic": false,                            // Auto-run uic on .ui save
  "qt.autoRcc": false,                            // Auto-run rcc on .qrc save
  "qt.testAutoDiscover": true,                    // Auto-discover Qt Test classes
  "qt.debuggerType": "auto"                       // auto, cppvsdbg, gdb, lldb
}
```

### 📊 Telemetry

Qt C++ Tools includes an **opt-in, disabled-by-default** telemetry feature to help guide future development.

- **No PII is collected.** Events include only anonymous metadata such as command IDs, build durations/outcomes, feature-flag snapshots, activation counts, platform, extension version, and timestamp.
- **You control it.** Use `Qt: Configure Telemetry` to enable or disable telemetry at any time, or set `qt.telemetryEnabled` in settings.
- **Local by default.** Events are stored locally in the extension's global storage. Use `Qt: Export Telemetry Data` to inspect the queued events.
- **Optional remote flush.** If you configure `qt.telemetryEndpoint`, enabled events are flushed periodically to that HTTPS endpoint.

## Requirements

### Software Requirements
- **VS Code**: Version 1.85.0 or higher
- **Node.js**: Version 18.x or higher (for development only)
- **Qt**: Qt 5.x or Qt 6.x installation
- **Compiler**: 
  - MSVC (Visual Studio 2017/2019/2022) or
  - MinGW (typically bundled with Qt)

### Qt Installation Detection
The extension automatically searches for Qt in:
- Configured paths (`qt.qmakePath` or `qt.qtInstallPath`)
- `QTDIR` environment variable
- System PATH
- Common installation directories:
  - `C:\Qt`
  - `C:\Program Files\Qt`
  - `%USERPROFILE%\Qt`

## Installation

### Method 1: From VSIX (Recommended for Testing)

1. **Build and Install Using Script**:
   ```powershell
   # Navigate to extension directory
   cd "C:\Users\Akhil\OneDrive\Documents\Github Projects\Qt-VSC-Extension"
   
   # Run installation script
   .\install.ps1
   ```

2. **Restart VS Code** or reload window (`Ctrl+Shift+P` → "Reload Window")

### Method 2: Manual Installation

1. **Install Dependencies**:
   ```powershell
   npm install
   ```

2. **Compile TypeScript**:
   ```powershell
   npm run compile
   ```

3. **Package Extension**:
   ```powershell
   npm run package
   ```

4. **Install VSIX**:
   ```powershell
   code --install-extension qt-vsc-extension-1.16.0.vsix --force
   ```

### Method 3: Development Mode

For development and testing:

1. Open this folder in VS Code
2. Press `F5` to launch Extension Development Host
3. Test the extension in the new window

## Quick Start

### For Existing Qt Projects

1. **Open Your Qt Project**:
   - Open a folder containing `.pro` or `CMakeLists.txt` files

2. **Build Your Project**:
   - Press `Ctrl+Shift+P`
   - Type "Qt: Build Project"
   - Or use `Ctrl+Shift+B` to see all build tasks

3. **Run Your Application**:
   - Press `Ctrl+Shift+P`
   - Type "Qt: Run Project"

### Configure Qt Path (if not auto-detected)

1. Press `Ctrl+Shift+P`
2. Type "Qt: Configure Qt Installation Path"
3. Navigate to your `qmake.exe` (e.g., `C:\Qt\6.5.0\msvc2019_64\bin\qmake.exe`)

## Supported Project Types

### QMake Projects (`.pro` files)
- Standard Qt widget applications
- Qt Quick/QML applications
- Qt libraries
- Subdirs projects

### CMake Projects (`CMakeLists.txt`)
- Projects using `find_package(Qt5 ...)` or `find_package(Qt6 ...)`
- Projects with `CMAKE_AUTOMOC`, `CMAKE_AUTOUIC`, `CMAKE_AUTORCC`

## Extension Architecture

```
Qt-VSC-Extension/
├── src/
│   ├── extension.ts              # Main extension entry point
│   ├── qtConfigManager.ts        # Qt installation detection & config
│   ├── qtProjectDetector.ts      # Project file scanning & parsing
│   ├── qtTaskProvider.ts         # Task provider for build/clean/run
│   ├── qmlSupport.ts             # QML format, lint, preview
│   ├── qmlCppBridge.ts           # QML-C++ cross-language indexer
│   ├── qmlCppBridgeProviders.ts  # Definition, completion, hover, reference providers
│   ├── qtDebugger.ts             # Debug configuration & pretty printers
│   ├── qtTestFramework.ts        # Qt Test discovery & execution
│   ├── qtBuildAnalytics.ts       # Build history & ccache/sccache
│   ├── qtProfiling.ts            # QML/CPU/Memory profilers & slow target detection
│   └── ... (30+ modules)
├── package.json                  # Extension manifest
├── tsconfig.json                 # TypeScript configuration
└── .vscode/
    ├── launch.json               # Debug configuration
    └── tasks.json                # Build tasks
```

## Troubleshooting

### Extension Not Finding Qt

1. **Manual Configuration**:
   ```json
   {
     "qt.qmakePath": "C:\\Qt\\6.5.0\\msvc2019_64\\bin\\qmake.exe"
   }
   ```

2. **Check Output Channel**:
   - `View` → `Output`
   - Select "Qt C++ Tools" from dropdown
   - Look for detection logs

### Build Fails

1. **Verify Compiler**:
   - Ensure MSVC or MinGW is installed and accessible
   - For MSVC: Open VS Code from "Developer Command Prompt"

2. **Check Build Directory**:
   - Default: `${workspaceFolder}/build`
   - Ensure write permissions

3. **Problem Matchers**:
   - Extension includes `$msCompile`, `$gcc`, and `qt-qmake` problem matchers
   - Build errors should appear in Problems panel (`Ctrl+Shift+M`)

### Multiple Qt Versions

Use `Qt: Select Qt Version` command to switch between detected installations.

## Roadmap

See **[ROADMAP.md](ROADMAP.md)** for a detailed, versioned breakdown of completed features and upcoming work.

**Quick summary:**
- ✅ **v0.0.1** — Build, Clean, Rebuild, Run; QMake & CMake support; Qt auto-detection; MSVC/MinGW; Status bar & sidebar UI
- ✅ **v0.1.0** — Project creation wizards (QMake & CMake)
- ✅ **v0.2.0** — Qt Designer integration, `.ui` / `.qrc` support
- ✅ **v0.3.0** — `windeployqt` deployment, IntelliSense helper
- ✅ **v0.4.0** — Qt code intelligence (autocomplete, snippets, hover docs)
- ✅ **v0.5.0** — Enhanced sidebar, build config selector, Qt Creator import
- ✅ **v0.6.0** — Parallel build control, incremental build optimization, build error quick-fixes
- ✅ **v1.0.0** — Cross-platform support (Windows, macOS, Linux)
- ✅ **v1.1.0** — Package manager integration (Homebrew, APT, Pacman, vcpkg, Conan, aqtinstall)
- ✅ **v1.2.0** — QML language support (syntax highlighting, formatter, linter, preview)
- ✅ **v1.3.0** — QML-C++ Bridge (Go to Definition, Find References, autocomplete)
- ✅ **v1.4.0** — Debugging integration (launch.json generation, pretty printers, signal/slot breakpoints)
- ✅ **v1.5.0** — Qt Test Framework integration (Test Explorer)
- ✅ **v1.6.0** — Internationalization (lupdate, lrelease, Qt Linguist)
- ✅ **v1.7.0** — Qt for Python (PySide/PyQt) support
- ✅ **v1.8.0** — Advanced code generation (MOC, UIC, RCC automation)
- ✅ **v1.9.0** — Generated code navigation & PCH support
- ✅ **v1.10.0** — Custom build system & PCH build integration
- ✅ **v1.11.0** — Build script injection & direct PCH compiler configuration
- ✅ **v1.12.0** — CI/CD integration (GitHub Actions, GitLab CI)
- ✅ **v1.13.0** — Qt Installer Framework integration
- ✅ **v1.14.0** — Build analytics & compiler cache (ccache/sccache)
- ✅ **v1.15.0** — Profiling & performance diagnostics (QML Profiler, CPU Profiler, Memory Leak Detection, Slow Target Detection)
- ✅ **v1.16.0** — QML type inference (`QML_ELEMENT` / `QML_SINGLETON`) & hot reload on save
- ✅ **v1.17.0 (Shipped)** — QML Language Server (`qmlls`) & Modern CMake Preset Support
- ✅ **v1.18.0 (Shipped)** — QML Testing (`qmltestrunner`) & Qt Code Quality (clazy, offline docs)
- ✅ **v1.19.0 (Shipped)** — Android Deployment & Build Kit Profiles
- ✅ **v1.20.0 (Shipped)** — iOS Deployment & Qt for WebAssembly
- ✅ **v2.0.0 (Shipped)** — Completeness & Polish
- ✅ **v2.1.0 (Shipped)** — Advanced Mobile & Embedded (TestFlight, bundletool, logcat, remote deploy/debug, Yocto, sysroot)
- ✅ **v2.2.0 (Shipped)** — LSP & Deep Code Intelligence (custom Qt C++ LSP server, signal/slot rename, cross-reference)
- ✅ **v2.3.0 (Current)** — Extension icon and branding

## Contributing

This extension is in active development. Contributions, issues, and feature requests are welcome!

### Development Setup

1. Clone the repository
2. Install dependencies: `npm install`
3. Open in VS Code
4. Press `F5` to launch Extension Development Host

### Building

```powershell
npm run compile  # Compile TypeScript
npm run watch    # Watch mode for development
npm run package  # Create .vsix package
```

## License

MIT License - See [LICENSE](LICENSE) file for details

## Credits

Created by Akhil Pawar  
Inspired by Qt Creator's workflow

## Support

- **Issues**: Report bugs or request features via GitHub Issues
- **Documentation**: See this README and inline code documentation
- **Output Channel**: Check "Qt C++ Tools" output for logs and diagnostics

---

**Happy Qt Development in VS Code! 🚀**
