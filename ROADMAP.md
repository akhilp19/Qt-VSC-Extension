# Qt C++ Tools — Extension Roadmap

> A living document tracking what has shipped, what is next, and what is on the horizon for the Qt C++ Tools VS Code extension.

---

## ✅ Version 0.0.1 (Released)

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

## ✅ Version 0.1.0 (Released) — Project Creation Wizards

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

## ✅ Version 0.2.0 (Released) — Qt Asset Integration

**Theme:** Bring Qt Designer and resource workflows into VS Code.

- [x] **`.ui` file support**
  - Open `.ui` files in Qt Designer from VS Code (external launch)
  - Context-menu action: "Open in Qt Designer"

- [x] **`.qrc` (Qt Resource File) support**
  - Syntax highlighting / basic IntelliSense for `.qrc` XML
  - Validate resource paths
  - Context action to run `rcc` manually

- [x] **Qt Designer integration (lightweight)**
  - Detect `designer.exe` alongside the selected Qt installation
  - Command: `Qt: Open Current File in Qt Designer`

---

## ✅ Version 0.3.0 (Current — Shipped) — Deployment & Tooling

**Theme:** Close the loop from build to runnable/distributable app.

- [x] **`windeployqt` integration**
  - Command: `Qt: Deploy Application`
  - Auto-detects `windeployqt.exe` from the active Qt installation or PATH
  - Automatically finds the built executable (no manual path needed)
  - Configurable deploy directory (`qt.deployDirectory`)
  - Supports additional `windeployqt` arguments via settings
  - Shows progress notification during deployment

- [x] **IntelliSense configuration helper**
  - Command: `Qt: Configure IntelliSense`
  - Auto-generate `.vscode/c_cpp_properties.json` with Qt paths
  - Queries `qmake` for `QT_INSTALL_HEADERS`, libs, and bins
  - Adds Qt module include paths (QtCore, QtGui, QtWidgets, QtNetwork, etc.)
  - Detects compiler path automatically (MSVC via `vswhere`, MinGW `g++.exe`)
  - Sets correct `intelliSenseMode` (`windows-msvc-x64` or `windows-gcc-x64`)
  - Adds common Qt defines (`QT_CORE_LIB`, `QT_GUI_LIB`, `QT_WIDGETS_LIB`, etc.)
  - Safely creates or updates config without overwriting other entries

- [x] **Pre-build / Post-build hooks**
  - Settings: `qt.preBuildCommand` and `qt.postBuildCommand`
  - Executes before/after every Build and Rebuild task
  - Works for both QMake and CMake projects
  - Perfect for code generation, asset copying, or custom build steps

---

## 🚧 Version 0.4.0 — Qt Code Intelligence

**Theme:** Bring Qt-specific autocomplete, snippets, and documentation into VS Code.

- [ ] **Qt class and method autocomplete**
  - Parse Qt headers to provide `CompletionItemProvider` for Qt classes
  - Suggest methods, enums, and constants from `QObject`, `QWidget`, `QString`, etc.
  - Context-aware suggestions (e.g., only `QWidget` methods when inside a widget class)

- [ ] **Signal / Slot helper**
  - Autocomplete for `connect(sender, SIGNAL(...), receiver, SLOT(...))`
  - Detect `signals:` and `slots:` sections in header files
  - Suggest available signals when typing `connect()`

- [ ] **Qt snippets**
  - `qhead` → boilerplate `.h` file with `Q_OBJECT`
  - `qslot` → `private slots:` stub
  - `qsig` → `signals:` stub
  - `qconnect` → `QObject::connect(...)` template

- [ ] **Documentation on hover**
  - Show Qt documentation summary when hovering over Qt classes/methods
  - Link to official Qt docs (doc.qt.io)

- [ ] **MOC-aware IntelliSense**
  - Recognize `Q_PROPERTY`, `Q_INVOKABLE`, `Q_ENUM` macros
  - Provide completions for QML-exposed C++ properties

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

> **Last updated:** June 7, 2026  
> For the latest status, check the [GitHub Issues](https://github.com/akhilpawar/Qt-VSC-Extension/issues) page.
