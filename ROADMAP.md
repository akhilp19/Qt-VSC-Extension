# Qt C++ Tools — Extension Roadmap

> A living document tracking what has shipped, what is next, and what is on the horizon for the Qt C++ Tools VS Code extension.

---

## ✅ Version 0.0.1 (Current — Shipped)

### Build System Integration
- [x] Auto-detect Qt projects (`.pro` for QMake, `CMakeLists.txt` for CMake)
- [x] Build, Clean, Rebuild, and Run commands via Command Palette
- [x] VS Code Task Provider integration (`Ctrl+Shift+B`)
- [x] Integrated terminal output with problem matchers
- [x] Multi-root workspace support

### Qt Installation & Toolchain
- [x] Auto-detection of Qt installations (QTDIR, PATH, common Windows dirs)
- [x] Manual Qt path configuration via file picker
- [x] Multi-version switching via Quick Pick
- [x] MSVC toolchain support (nmake / jom)
- [x] MinGW toolchain support (mingw32-make)

### User Interface
- [x] Status bar buttons (Build, Run, Clean)
- [x] Qt Projects sidebar tree view with inline action icons
- [x] Auto-refresh on file add/remove
- [x] Output channel logging ("Qt C++ Tools")

### Configuration
- [x] 11 configurable settings (`qt.qmakePath`, `qt.buildDirectory`, `qt.defaultBuildType`, etc.)
- [x] Custom additional arguments for qmake and cmake
- [x] Build type selection (debug / release)

---

## ✅ Version 0.1.0 — Project Creation Wizards

**Theme:** Turn the two placeholder commands into real project generators.

- [x] **QMake Project Wizard** (`Qt: Create New QMake Project`)
  - Prompt for project name, target type (app / library / console), and modules (Core, Gui, Widgets, Quick, etc.)
  - Generate `.pro`, `main.cpp`, and basic folder structure
  - Optionally generate a `.h`/`.cpp`/`.ui` trio for the main window (Widgets app)
  - Supports: Widgets App, Console App, Quick App, Static Lib, Shared Lib

- [x] **CMake Project Wizard** (`Qt: Create New CMake Project`)
  - Prompt for project name, target type, Qt version (Qt5 / Qt6), and modules
  - Generate `CMakeLists.txt`, `main.cpp`, and folder structure
  - Set up `CMAKE_AUTOMOC`, `CMAKE_AUTOUIC`, `CMAKE_AUTORCC`
  - Supports: Widgets App, Console App, Quick App, Static Lib, Shared Lib

- [x] **Template extensibility** — internal template engine (`projectTemplates.ts`) so future templates can be added easily

---

## 🚧 Version 0.2.0 — Qt Asset Integration

**Theme:** Bring Qt Designer and resource workflows into VS Code.

- [ ] **`.ui` file support**
  - Open `.ui` files in Qt Designer from VS Code (external launch)
  - Context-menu action: "Open in Qt Designer"

- [ ] **`.qrc` (Qt Resource File) support**
  - Syntax highlighting / basic IntelliSense for `.qrc` XML
  - Validate resource paths
  - Context action to run `rcc` manually

- [ ] **Qt Designer integration (lightweight)**
  - Detect `designer.exe` alongside the selected Qt installation
  - Command: `Qt: Open Current File in Qt Designer`

---

## 🚧 Version 0.3.0 — Deployment & Tooling

**Theme:** Close the loop from build to runnable/distributable app.

- [ ] **`windeployqt` integration**
  - Command: `Qt: Deploy Application`
  - Detects built executable and runs `windeployqt` with correct args
  - Configurable deploy directory

- [ ] **IntelliSense configuration helper**
  - Auto-generate `c_cpp_properties.json` entries based on the active Qt installation
  - Include paths for Qt headers, defines like `QT_CORE_LIB`, etc.

- [ ] **Pre-build / Post-build hooks**
  - Allow user-defined commands to run before/after build (e.g., code generation, copying assets)

---

## 🔮 Future

- [ ] **Cross-platform support**
  - macOS (`.app` bundles, `macdeployqt`)
  - Linux (`make`, `gcc`, `linuxdeployqt`)

- [ ] **Enhanced Sidebar**
  - Build configuration selector (Debug / Release) directly in the Qt Projects view
  - Project properties panel (Qt version, build dir, etc.)
  - Build history / last build status indicator

- [ ] **Advanced Build Features**
  - Parallel build control (jom by default on MSVC)
  - Incremental build optimization hints
  - Build error quick-fix suggestions

- [ ] **Project Import**
  - Import existing Qt Creator `.pro.user` or `.qbs` metadata where possible

---

## How to Contribute

1. Pick an open item from the upcoming version.
2. Open an issue to discuss design if it involves new UI or user-facing behavior.
3. Submit a PR referencing the roadmap item.

> For the latest status, check the [GitHub Issues](https://github.com/akhilpawar/Qt-VSC-Extension/issues) page.
