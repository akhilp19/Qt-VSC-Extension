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

## ✅ Version 0.3.0 (Released) — Deployment & Tooling

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

## ✅ Version 0.4.0 (Released) — Qt Code Intelligence

**Theme:** Bring Qt-specific autocomplete, snippets, and documentation into VS Code.

- [x] **Qt class and method autocomplete**
  - Parse Qt headers to provide `CompletionItemProvider` for Qt classes
  - Suggest methods, enums, and constants from `QObject`, `QWidget`, `QString`, etc.

- [x] **Signal / Slot helper**
  - Autocomplete for `connect(sender, SIGNAL(...), receiver, SLOT(...))`
  - Detect `signals:` and `slots:` sections in header files
  - Suggest available signals when typing `connect()`

- [x] **Qt snippets**
  - `qhead` → boilerplate `.h` file with `Q_OBJECT`
  - `qslot` → `private slots:` stub
  - `qsig` → `signals:` stub
  - `qconnect` → `QObject::connect(...)` template

- [x] **Documentation on hover**
  - Show Qt documentation summary when hovering over Qt classes/methods
  - Link to official Qt docs (doc.qt.io)

- [x] **MOC-aware IntelliSense**
  - Recognize `Q_PROPERTY`, `Q_INVOKABLE`, `Q_ENUM` macros
  - Provide completions for QML-exposed C++ properties

> **Note:** Context-aware suggestions (e.g., only `QWidget` methods when inside a widget class) are deferred to v2.0.0.

---

## ✅ Version 0.5.0 (Released) — Enhanced Sidebar & Project Import

**Theme:** Make the Qt Projects sidebar a true project dashboard.

- [x] **Build configuration selector**
  - Switch Debug / Release directly in the Qt Projects view
  - Per-project build configuration overrides

- [x] **Project properties panel**
  - View/edit Qt version, build directory, and compiler per project
  - Quick-access settings from the sidebar

- [x] **Build history / status indicator**
  - Show last build result (success/failure) per project
  - Timestamp of last build

- [x] **Qt Creator project import**
  - Import `.pro.user` settings (build steps)

> **Note:** One-click re-build from status indicator and `.pro.user` run configuration import are deferred to v2.0.0.

---

## ✅ Version 0.6.0 (Released) — Advanced Build Features

**Theme:** Smarter, faster, and more reliable builds.

- [x] **Parallel build control**
  - Auto-use `jom` on MSVC when available
  - Configurable job count for `make` / `mingw32-make`

- [x] **Incremental build optimization**
  - Suggest `ccache` integration for faster compiles

- [x] **Build error quick-fix suggestions**
  - Offer common fixes in the Problems panel (e.g., missing `#include`, undeclared `Q_OBJECT`)
  - One-click apply via Code Actions

> **Note:** Automatic unnecessary-rebuild detection with warnings and proactive post-build ccache suggestions are deferred to v2.0.0.

---

## ✅ Version 1.0.0 (Released) — Cross-Platform Support

**Theme:** Take the extension beyond Windows.

- [x] **macOS support**
  - Detect Qt installations in `/Users/<user>/Qt`, `/usr/local/Qt`, `/opt/Qt`, `/Applications/Qt`
  - `macdeployqt` integration for app bundle deployment
  - Support `.app` bundle execution

- [x] **Linux support**
  - Detect Qt via `qmake` in PATH, `/usr/lib/qt*`, `/opt/qt*`, `/usr/local/qt*`
  - `make` / `gcc` / `clang` toolchain support
  - `linuxdeployqt` integration for deployment

- [x] **Platform abstraction layer**
  - `platformUtils.ts` — unified API for path, shell, and executable handling
  - Automatic `process.platform` detection at runtime

---

## ✅ Version 1.1.0 (Released) — Package Manager Integration

**Theme:** Support Qt installed via Homebrew, apt, pacman, vcpkg, Conan, and aqtinstall.

### Package Manager Detection
- [x] **`src/packageManagerDetector.ts`** — central detection module with 6 package manager backends
- [x] **Homebrew** (macOS / Linux)
  - Detect Qt via `brew --prefix qt@6`, `brew --prefix qt@5`, `brew --prefix qt`
  - Read `Cellar/qt/` symlinks to find actual install paths
  - Support versioned formulae (`qt@5`, `qt@6`)
- [x] **APT / DPKG** (Debian / Ubuntu)
  - Detect Qt via standard paths `/usr/lib/x86_64-linux-gnu/qt5/`, `/usr/lib/qt5/`
  - Verify with `dpkg -S qmake` when available
- [x] **Pacman** (Arch / Manjaro)
  - Detect Qt via standard paths `/usr/lib/qt6/`, `/usr/lib/qt5/`
  - Verify with `pacman -Ql qt6-base` / `pacman -Ql qt5-base`
- [x] **vcpkg** (Cross-platform)
  - Read `VCPKG_ROOT` env var or find `vcpkg` in PATH
  - Query installed Qt packages via `vcpkg list qtbase`
  - Map vcpkg triplet paths to Qt include/lib directories
- [x] **Conan** (Cross-platform)
  - Search Conan 1 cache (`~/.conan/data/qt/`) and Conan 2 cache (`~/.conan2/p/`)
  - Find qmake in package bin directories
- [x] **aqtinstall** (Cross-platform)
  - Detect Qt installations in standard aqt paths (`~/Qt`, `C:\Qt`)
  - Look for aqt marker files (`.aqtinstall`, `aqtinstall.log`)

### Unified Package Manager UI
- [x] **Source badge** in Qt version picker showing `[Homebrew]`, `[APT]`, `[vcpkg]`, etc.
- [x] **`Qt: Install Qt` command** — shows platform-filtered QuickPick with install instructions for each package manager
- [x] **Auto-priority rules** — `qt.preferredPackageManager` setting (`auto` / `official` / `homebrew` / `apt` / `pacman` / `vcpkg` / `conan` / `aqtinstall`)
- [x] **`qt.packageManagerAutoDetect`** setting — toggle package manager scanning on/off
- [x] **`qt.showQtSource`** setting — toggle source badge display

---

## ✅ Version 1.2.0 (Released) — Qt Quick / QML Support

**Theme:** First-class QML development inside VS Code.

### QML Language Support
- [x] **Syntax highlighting** for `.qml` and `.qmltypes` files via `syntaxes/qml.tmLanguage.json` (TextMate grammar)
  - QML keywords (`import`, `property`, `signal`, `function`, `readonly`, etc.)
  - JavaScript keywords inside QML
  - QtQuick built-in types (`Item`, `Rectangle`, `Text`, `Button`, etc.)
  - Property bindings, signal handlers (`onClicked:`), comments, strings, numbers
- [x] **QML formatter** integration — `Qt: Format QML File` command runs `qmlformat -i`
- [x] **QML linting** via `qmllint` with inline diagnostics in the Problems panel
  - Parses `file:line:column: severity: message` output format
  - Auto-lint on save (controlled by `qt.qmlLintOnSave`)
  - Diagnostic collection with Error/Warning/Info severity mapping
- [x] **QML type inference** — resolve custom QML types defined in C++ (`QML_ELEMENT`, `QML_SINGLETON`)

### QML Preview
- [x] **QML Preview** command — `Qt: Preview QML File` launches `qmlscene` with the current `.qml` file
  - Finds `qmlscene` in Qt bin directory or PATH
  - Sets `QML2_IMPORT_PATH` from active Qt installation
  - Supports additional args via `qt.qmlPreviewArgs` setting
  - Supports additional import paths via `qt.qmlPreviewImportPath` setting
- [x] **Hot reload** on save — automatically restarts qmlscene when the QML file is saved

### QML Snippets
- [x] **16 QML snippets** registered for `.qml` files:
  - `qapp` → full Window application, `qitem` → Item, `qrect` → Rectangle
  - `qtext` → Text, `qbutton` → Button, `qlistview` → ListView
  - `qmousearea` → MouseArea, `qsignal` → signal, `qfunction` → function
  - `qproperty` → property, `qimport` → import, `qconnections` → Connections
  - `qcolumn` → Column, `qrow` → Row, `qstate` → State, `qtimer` → Timer

---

## ✅ Version 1.3.0 (Released) — QML-C++ Bridge

**Theme:** Bridge QML and C++ codebases for seamless navigation.

### Go to Definition (QML → C++)
- [x] **QML DefinitionProvider** — `F12` on a QML property binding or method call jumps to C++ declaration
  - Regex-based C++ header scanner extracts `Q_PROPERTY`, `Q_INVOKABLE`, `QML_ELEMENT`, `QML_NAMED_ELEMENT`
  - QML file scanner extracts property bindings and method calls
  - Resolves `id.propertyName` patterns via workspace `id:` declaration map
  - Returns `vscode.Location` pointing to exact C++ file and line

### Find References (C++ → QML)
- [x] **C++ ReferenceProvider** (experimental) — `Shift+F12` on `Q_INVOKABLE` / `Q_PROPERTY` lists QML usages
  - Scans all QML files for property bindings and method calls
  - Basic name-only matching (not type-qualified)

### Autocomplete (QML)
- [x] **QML CompletionItemProvider** — suggests C++-exposed properties and methods inside QML blocks
  - `Q_PROPERTY` items shown as Property kind with `propertyName: ${1:value}` snippet
  - `Q_INVOKABLE` items shown as Method kind with `methodName(${1})` snippet
  - Shows C++ signature and class name in completion details

### Indexing
- [x] **`Qt: Rebuild QML-C++ Index`** command — manual re-index trigger
- [x] **Auto-reindex** on save of `.h`, `.hpp`, `.cpp`, `.qml` files (2-second debounce)
- [x] **Settings:** `qt.qmlCppBridgeEnabled` (toggle), `qt.qmlCppIndexExclude` (glob patterns)

### Architecture
- `src/qmlCppBridge.ts` — `QmlCppBridgeIndexer` with C++ scanner, QML scanner, and lookup maps
- `src/qmlCppBridgeProviders.ts` — `QmlDefinitionProvider`, `QmlCompletionProvider`, `CppReferenceProvider`
- Index stores: `Map<qmlTypeName, CppQmlSymbol[]>`, `Map<symbolName, QmlUsage[]>`, `Map<id, qmlType>`

**Known limitations (fixed in v1.16.0):**
- ✅ `QML_SINGLETON` — now fully supported
- ❌ `QML_ATTACHED` — deferred to v2.0.0
- Regex-based C++ parsing (not a full AST) — may miss complex template types in Q_PROPERTY, multiline macros, or preprocessor conditionals
- Only scans workspace folders (not system includes) — Qt built-in QML types are not indexed
- ReferenceProvider matches by symbol name only, not type-qualified name

---

## ✅ Version 1.4.0 (Released) — Debugging Integration

**Theme:** Seamless Qt-aware debugging without leaving VS Code.

### Debugger Configuration
- [x] **Auto-generate `launch.json`** for Qt projects
  - Detects debugger type from compiler + platform:
    - Windows + MSVC → `cppvsdbg`
    - Windows + MinGW → `cppdbg` + `MIMode: gdb`
    - macOS → `cppdbg` + `MIMode: lldb`
    - Linux → `cppdbg` + `MIMode: gdb`
  - Finds built executable heuristically from build directory + project name
  - Generates two configs per project: `"Debug <Project>"` and `"Debug <Project> (QML)"`
  - Appends to existing `.vscode/launch.json` without overwriting (deduplicates by name)
  - Creates `.vscode/` directory + `launch.json` if missing
- [x] **`qt.generateLaunchJson`** command — "Qt: Generate Debug Launch Configuration"
- [x] **`qt.debuggerType`** setting — override auto-detected debugger (`auto` / `cppvsdbg` / `gdb` / `lldb`)
- [x] **`qt.debugAdditionalArgs`** setting — extra args passed to debug target

### Qt Pretty Printers
- [x] **Shipped `scripts/qt_pretty_printers.py`** with Python pretty printers for gdb/LLDB
  - `QString` → human-readable string (UTF-16)
  - `QByteArray` → bytes preview with total size
  - `QList` / `QVector` → list with item count + first 50 items
  - `QMap` / `QHash` → dict with key:value pairs (first 30 nodes)
  - `QVariant` → contained type name + value
  - `QUrl` → reconstructed URL string
  - `QDateTime` → ISO timestamp
  - `QDate` → YYYY-MM-DD
  - `QTime` → HH:MM:SS.mmm
- [x] **`Qt: Setup Qt Pretty Printers`** command with two modes:
  - **Add to launch.json** — injects `setupCommands` with `source /path/to/qt_pretty_printers.py` into existing Qt debug configs
  - **Generate .gdbinit** — creates `.gdbinit` in workspace root referencing the script
- [x] Auto-copies printer script to workspace `.vscode/qt_pretty_printers.py`

### Signal/Slot Breakpoint Support
- [x] **`Qt: Add Signal/Slot Breakpoint`** command
  - Adds a `FunctionBreakpoint` on `QObject::connect` via VS Code debug API
  - Traces signal/slot connections at runtime

### QML Debugging
- [x] **QML debug launch config** — `"Debug <Project> (QML)"` adds `-qmljsdebugger=port:3768,block` to args
- [x] **`qt.qmlDebugPort`** setting — configurable port for QML JS debugger

---

## ✅ Version 1.5.0 (Released) — Qt Test Framework Integration

**Theme:** Run, debug, and visualize Qt Test results inside VS Code.

### Test Discovery
- [x] **Auto-detect `QObject` test classes** in workspace C++ files
  - Regex scanner finds `class X : public QObject` with `Q_OBJECT` + `private slots:`
  - Extracts `test_*`, `initTestCase`, `cleanupTestCase`, `init`, `cleanup` methods
  - Detects `QTEST_MAIN(Class)` / `QTEST_APPLESS_MAIN(Class)` markers
  - Excludes `build/`, `out/`, `.git/`, `node_modules/` directories
- [x] **Test Explorer integration** — populates VS Code's native Testing sidebar via `TestController`
  - Root items: test classes (e.g., `TestFoo`)
  - Child items: individual test methods (`test_something`)
  - `TestItem.uri` and `range` point to source declaration for navigation
- [x] **Auto-refresh** on save of `.h`/`.hpp`/`.cpp` files (2-second debounce)
- [x] **`qt.testAutoDiscover`** setting — toggle auto-discovery on/off

### Test Execution
- [x] **Run profile** — `Run Qt Tests` via Test Explorer (default profile)
  - Run individual test method: `./testbinary ClassName::methodName`
  - Run full test class: `./testbinary ClassName`
  - Run all tests: `./testbinary`
- [x] **Debug profile** — `Debug Qt Tests` via Test Explorer
  - Launches test binary under VS Code debugger
  - Uses auto-detected debugger (cppvsdbg / gdb / lldb)
  - Individual method filtering supported (args passed to debug session)
- [x] **Real-time output parsing** — parses QTest text output as it arrives
  - `PASS   : ClassName::methodName()`
  - `FAIL!  : ClassName::methodName() message (file.cpp:42)`
  - `SKIP   : ClassName::methodName() message`
- [x] **Cancellation support** — respects VS Code cancellation token, kills test process

### Test Output & Failure Reporting
- [x] **Pass/fail/skip reporting** via `testRun.passed()` / `failed()` / `skipped()`
- [x] **Failure messages** with file/line location in Test Explorer detail panel
  - `TestMessage` includes failure description
  - `TestMessage.location` points to assertion failure source
- [x] **Diff view** for failures via `vscode.TestMessage.diff()`

### Architecture
- `src/qtTestFramework.ts` — `QtTestFramework` class managing `TestController`
- Uses VS Code's native Testing API (`vscode.tests.createTestController`)
- Executable discovery reuses debugger heuristic (`buildDir` + `projectName`)
- Test output parsed in real-time from `stdout` stream

**Known limitations:**
- Test executable found via same heuristic as debugger. Projects with separate test targets may need manual configuration.
- Regex-based discovery may miss test classes inside complex preprocessor conditionals or namespaces.
- Only discovers `private slots:` test methods; `public slots:` not detected.

---

## ✅ Version 1.6.0 (Released) — Internationalization (lupdate / lrelease)

**Theme:** Full i18n workflow for Qt applications.

### Translation File Management
- [x] **Auto-detect `.ts` files** in workspace and list in sidebar
  - New `Qt Translations` view under the Qt Projects explorer
  - Scans workspace excluding `build/`, `out/`, `.git/`, `node_modules/`
- [x] **Parse `.ts` XML** to compute completion percentage
  - Counts `<message>` elements vs finished `<translation>` elements
  - Shows `X%` as description next to each `.ts` file
  - Extracts language from `<TS language="...">`

### lupdate / lrelease Integration
- [x] **`Qt: Update Translations (lupdate)`** command
  - Finds `lupdate` in Qt bin directory or PATH
  - Auto-detects `.pro` or `CMakeLists.txt` project file
  - For CMake projects without explicit TRANSLATIONS, collects all source files and `.ts` files
  - Shows progress notification during execution
  - Parses output for errors/warnings
- [x] **`Qt: Compile Translations (lrelease)`** command
  - Finds `lrelease` in Qt bin directory or PATH
  - Runs on all detected `.ts` files or project file
  - Shows progress notification
- [x] **`qt.lupdateArgs`** and **`qt.lreleaseArgs`** settings — additional arguments

### Qt Linguist Integration
- [x] **`Qt: Open in Qt Linguist`** command
  - Finds `linguist` in Qt bin directory or PATH
  - Launches detached process with selected `.ts` file
  - Available from sidebar, Explorer context menu on `.ts` files, and Command Palette

### Missing Translation Diagnostics
- [x] **Diagnostic collection** for unfinished translations
  - Scans `.ts` files for `<translation type="unfinished">`, empty translations
  - Creates `Warning` diagnostics on the `.ts` file
  - Updates on `.ts` file save

### Sidebar Actions
- [x] **Refresh** button in `Qt Translations` view
- [x] Context menu on `.ts` files: Open in Linguist, Compile (lrelease)

**Known limitations:**
- Diagnostics are attached to `.ts` files rather than source files (simplified approach)
- Large `.ts` files may take a moment to parse for completion percentage

---

## ✅ Version 1.7.0 (Released) — Qt for Python (PySide / PyQt) Support

**Theme:** Extend the extension to Python-based Qt projects.

### Python Project Detection
- [x] **Detect PySide6 / PyQt6 / PySide2 / PyQt5** projects
  - Scans `.py` files for `from PySide6 import`, `import PyQt6`, etc.
  - Checks `requirements.txt` for Qt binding package names
  - Python Qt projects appear in Qt Projects sidebar alongside C++ projects
  - Project type: `'python'` (extends `'qmake'` / `'cmake'`)

### Python Qt Tooling
- [x] **`Qt: Compile .ui to Python (pyside6-uic)`** command
  - Finds `pyside6-uic` / `pyuic5` / `pyside2-uic` in Qt bin, Python scripts dir, or PATH
  - Generates `*_ui.py` from `.ui` file
  - Auto-detects binding from workspace or `qt.pythonQtBinding` setting
  - Open generated file notification
- [x] **`Qt: Compile .qrc to Python (pyside6-rcc)`** command
  - Finds `pyside6-rcc` / `pyrcc5` / `pyside2-rcc`
  - Generates `*_rc.py` from `.qrc` file
- [x] **`Qt: Open Qt Designer (Python)`** command
  - Finds `pyside6-designer` or falls back to regular `designer`
  - Launches detached process
- [x] **`qt.pythonQtBinding`** setting — `auto` / `PySide6` / `PyQt6` / `PySide2` / `PyQt5`

### Python Qt Snippets
- [x] **12 Python Qt snippets** registered for `.py` files:
  - `pyside-app` / `pyqt-app` — Full QApplication + MainWindow
  - `pyside-widget` — QWidget subclass
  - `pyside-slot` / `pyqt-slot` — `@Slot()` / `@pyqtSlot()` decorator
  - `pyside-signal` / `pyqt-signal` — `Signal()` / `pyqtSignal()` declaration
  - `pyside-connect` — `button.clicked.connect(self.handler)`
  - `pyside-main` / `pyqt-main` — main block with QApplication
  - `pyside-action` — QAction with shortcut and connect
  - `pyside-msgbox` — QMessageBox
  - `pyside-filedlg` — QFileDialog

### Build System
- [x] **Python projects** in task provider — only Run task is created (no build/clean/rebuild)
- [x] **Run task** executes `python <file.py>` for Python Qt projects

---

## ✅ Version 1.8.0 (Released) — Advanced Code Generation (MOC, UIC, RCC Automation)

**Theme:** Eliminate manual build steps for generated code.

### Automatic Code Generation
- [x] **MOC file watching**
  - Watch `.h` / `.hpp` files containing `Q_OBJECT` macro
  - Auto-run `moc` on save and generate `moc_*.cpp`
  - Configurable output directory via `qt.generatedCodeDirectory`
  - 500ms debounce to prevent duplicate runs

- [x] **UIC file watching**
  - Watch `.ui` files
  - Auto-run `uic` to generate `ui_*.h` on save

- [x] **RCC file watching**
  - Watch `.qrc` files
  - Auto-run `rcc` to generate `qrc_*.cpp` on save

### Manual Commands
- [x] **`Qt: Generate MOC`** — manual MOC on selected header file
- [x] **`Qt: Generate UIC`** — manual UIC on selected `.ui` file
- [x] **`Qt: Generate RCC`** — manual RCC on selected `.qrc` file
- [x] **Explorer context menu** entries for `.h`/`.hpp`, `.ui`, and `.qrc` files
- [x] **Open generated file** notification after manual generation

### Settings
- [x] **`qt.autoMoc`** — toggle auto MOC on save (default: `false`)
- [x] **`qt.autoUic`** — toggle auto UIC on save (default: `false`)
- [x] **`qt.autoRcc`** — toggle auto RCC on save (default: `false`)
- [x] **`qt.generatedCodeDirectory`** — output directory for generated code (supports `${workspaceFolder}`)

---

## ✅ Version 1.9.0 (Released) — Generated Code Navigation & PCH Support

**Theme:** Navigate between source and generated code, plus precompiled header generation.

### Generated Code Navigation
- [x] **Go to Generated Code** (`Alt+G`) — jump from `.h` → `moc_*.cpp`, `.ui` → `ui_*.h`, `.qrc` → `qrc_*.cpp`
- [x] **Peek Generated Code** (`Alt+Shift+G`) — show generated file inline via VS Code peek widget
- [x] **Definition Provider** — `F12` on a class in a `Q_OBJECT` header also offers the generated `moc_*.cpp`
- [x] **Smart fallback** — if generated file is missing, prompts to run Generate MOC/UIC/RCC first
- [x] **Explorer context menus** for `.h`/`.hpp`, `.ui`, and `.qrc` files

### Precompiled Header (PCH) Support
- [x] **`Qt: Generate Precompiled Header`** command
- [x] Auto-detect Qt modules from `.pro` or `CMakeLists.txt`
- [x] Interactive multi-select QuickPick with 50+ Qt headers grouped by module
- [x] Generates `qt_pch.h` with `#pragma once`
- [x] Build-system instructions (QMake, CMake, MSVC) with copy-to-clipboard

---

## ✅ Version 1.10.0 (Released) — Custom Build System Integration & PCH Build Integration

**Theme:** Support raw Qt projects without QMake/CMake, and auto-integrate PCH into build files.

### Custom Build System Integration
- [x] **Raw Qt project detection** — finds folders with Qt `#include`s but no `.pro` or `CMakeLists.txt`
- [x] **Generate Custom Makefile** — interactive Makefile generation with MOC/UIC/RCC rules
- [x] **Qt module detection** from `#include` patterns in source files
- [x] **Task provider integration** — Build/Clean/Run tasks for raw projects
- [x] **Smart exclusion** — skips directories inside existing QMake/CMake projects

### Precompiled Header Build Integration
- [x] **Integrate PCH into QMake** — auto-append `PRECOMPILED_HEADER` and `CONFIG += precompile_header` to `.pro`
- [x] **Integrate PCH into CMake** — auto-insert `target_precompile_headers()` with target detection
- [x] **Change preview** — shows additions before applying with confirmation dialog
- [x] **Duplicate protection** — detects existing PCH config and aborts
- [x] **CMake target name fallback** — manual input if auto-detection fails

---

## ✅ Version 1.11.0 (Shipped) — Advanced Build Script Injection & Direct PCH Compiler Configuration

**Theme:** Inject code generation into existing build scripts and configure PCH compiler flags without modifying project files.

### Advanced Build Script Injection
- [x] **Detect existing build scripts** — `Makefile`, `build.sh`, `compile.bat`, and any `.sh`/`.bat` with compiler invocations
- [x] **Inject into existing Makefile** — appends MOC/UIC/RCC variable definitions and pattern rules
- [x] **Inject into shell/batch scripts** — inserts `moc`/`uic`/`rcc` commands before compiler invocations
- [x] **Smart fallback** — when generating a Makefile and one exists, offers "Inject into Existing"
- [x] **Automatic backups** — creates `.bak` / `.bak.1` / `.bak.2` before modifying
- [x] **Change preview** — shows added lines before applying
- [x] **Duplicate protection** — detects existing MOC/UIC rules and aborts

### Direct PCH Compiler Configuration
- [x] **Configure via VS Code Settings** — updates `C_Cpp.default.compilerArgs` in `settings.json` or `compilerArgs` in `c_cpp_properties.json`
- [x] **Configure via Build Tasks** — injects `CL` (MSVC) or `CXXFLAGS` (GCC/Clang) env vars into `.vscode/tasks.json`
- [x] **Auto-detect compiler family** from Qt installation
- [x] **Correct flags per compiler** — MSVC `/Yu/FI`, GCC/Clang `-include`
- [x] **No project file changes** — alternative to modifying `.pro` or `CMakeLists.txt`
- [x] **Post-generation shortcut** — "Configure Compiler Flags" button after generating `qt_pch.h`

---

## ✅ Version 1.12.0 (Shipped) — CI/CD Integration

**Theme:** One-click setup for building Qt projects in CI/CD pipelines.

### GitHub Actions
- [x] **Generate `.github/workflows/build.yml`**
  - Matrix builds: Windows (MSVC), macOS (Clang), Linux (GCC)
  - `jurplel/install-qt-action@v4` step to install Qt in CI
  - Cache Qt installation between runs
  - Artifact upload for built binaries

- [x] **Generate `.github/workflows/release.yml`**
  - Triggers on tag push (`v*.*.*`)
  - Builds on all platforms
  - Creates GitHub Release with attached artifacts

### GitLab CI
- [x] **Generate `.gitlab-ci.yml`** template
  - Linux build with `aqtinstall`
  - Artifact upload

---

## ✅ Version 1.13.0 (Shipped) — Qt Installer Framework

**Theme:** Generate and build native installers for Qt applications.

- [x] **Generate installer config** (`config.xml`, `package.xml`) for `binarycreator`
- [x] **Build installer** command — run `binarycreator` to produce `.exe` / `.dmg` / `.run` installer

---

## ✅ Version 1.14.0 (Shipped) — Build Analytics & Compiler Cache Integration

**Theme:** Help developers optimize their Qt builds with analytics and compiler caching.

### Build Performance
- [x] **Build time tracker** — logs per-project build durations with persistent history
- [x] **Build analytics dashboard** — sidebar tree view with build history, durations, success rates
- [x] **`ccache` / `sccache` integration**
  - Auto-detect and configure compiler cache
  - Show cache hit/miss stats

> **Note:** Build time regression alerts and per-file compilation time breakdown are deferred to v2.0.0.

---

## ✅ Version 1.15.0 (Shipped) — Profiling & Performance Diagnostics

**Theme:** Runtime profiling and compile-time diagnostics for Qt applications.

### Application Profiling
- [x] **QML Profiler launcher** — run app with `-qmljsdebugger=port:3768,block` and show instructions to connect Qt Creator QML Profiler
- [x] **CPU Profiler integration** — launch `perf` (Linux), `Instruments`/`sample` (macOS), or `VTune` (Windows/Linux) from VS Code
- [x] **Memory leak detection** — integrate `valgrind` (Linux), `drmemory` (Windows), `leaks` (macOS) for Qt apps
- [x] **Slow target detection** — analyze `.cpp` files by complexity heuristic (LOC, includes, templates) and show top slowest compilation targets

---

## ✅ Version 1.16.0 (Shipped) — QML Type Inference & Hot Reload

**Theme:** Resolve custom QML types from C++ and hot-reload QML previews.

- [x] **QML type inference** — resolve custom QML types defined in C++ via `QML_ELEMENT`, `QML_NAMED_ELEMENT`, `QML_SINGLETON`
- [x] **QML type completions** — C++-registered QML types offered in QML file completions
- [x] **QML type definition** — Ctrl+Click on QML type name jumps to C++ class definition
- [x] **QML type hover** — hover over QML type shows C++ class info and registration macro
- [x] **Hot reload on save** — `qt.qmlPreviewHotReload` setting auto-restarts `qmlscene` when QML file is saved
- [x] **Stop QML Preview** command — terminate running `qmlscene` process

---

## ✅ Version 1.17.0 (Shipped) — QML Language Server & Modern CMake Support

**Theme:** Real QML IntelliSense via Qt's official language server, and modern CMake preset workflows.

### QML Language Server (`qmlls`)
- [x] **Lightweight LSP client** for Qt 6.2+ `qmlls` shipped in `<Qt>/bin/`
- [x] **Auto-detect and start** `qmlls` with detected `QML_IMPORT_PATH` from workspace modules + Qt installation
- [x] **Graceful fallback** — if `qmlls` is not found (Qt5 or Qt6 < 6.2), existing regex-based QML providers continue unchanged
- [x] **Real QML completions, diagnostics, hover, document symbols, rename** via LSP (augmenting existing providers)

### CMake Preset Support
- [x] **Parse `CMakePresets.json`** and `CMakeUserPresets.json` (version >= 2)
- [x] **`Qt: Select CMake Preset`** command — interactive configure + build preset picker per project
- [x] **`Qt: Clear CMake Preset`** command — revert to default hardcoded `cmake -B build -S .` behavior
- [x] **Preset injection into build tasks** — CMake build/rebuild use `--preset <name>` when selected
- [x] **QMake projects completely unaffected**

### QML Module (`qmldir`) Support
- [x] **Parse `qmldir` files** in workspace to build type index
- [x] **QML import navigation** — Ctrl+Click on custom QML types defined in modules jumps to `.qml` file
- [x] **Module type completions** — `qmldir`-registered types appear in QML completion lists
- [x] **Auto-configure `QML_IMPORT_PATH`** for `qmlscene` preview and `qmlls`

---

## ✅ Version 1.18.0 (Shipped) — QML Testing & Qt Code Quality

**Theme:** Complete the QML testing story and add Qt-specific C++ static analysis.

### QML Test Explorer (`qmltestrunner`)
- [x] **Discover `TestCase` items** in `.qml` files (regex scan for `TestCase { name: ... }` and `function test_*()`)
- [x] **Run via `qmltestrunner`** — ships with Qt, parses `PASS`/`FAIL`/`XPASS`/`XFAIL` output
- [x] **Test Explorer integration** — populate VS Code's native Testing sidebar alongside C++ tests
- [x] **Reuses `QtTestFramework.ts` architecture**

### clazy / clang-tidy Integration
- [x] **Auto-detect `clazy-standalone`** or `run-clazy-tidy` in PATH / Qt installation
- [x] **Qt-specific static analysis** — detects old-style `connect()`, missing `tr()`, inefficient `QMap` iteration, etc.
- [x] **Diagnostics in Problems panel** — parse JSON/diagnostic output into `vscode.DiagnosticCollection`
- [x] **Settings:** `qt.clazyEnable`, `qt.clazyChecks`, `qt.clazyOnSave`

### Qt Offline Documentation Viewer
- [x] **Detect local Qt docs** — `Docs/Qt-6.x.x/` or `.qch` files from active Qt installation
- [x] **`Qt: Open Qt Documentation`** command — lists installed modules, opens local HTML in VS Code webview
- [x] **Update hover provider** — fallback to local docs when offline, instead of hardcoded `doc.qt.io` links

> **Note:** clazy auto-fix quick actions and `.clang-tidy` config file detection are deferred to v2.0.0.

---

## ✅ Version 1.19.0 (Shipped) — Android Deployment & Build Kit Profiles

**Theme:** Extend deployment from desktop to mobile targets, and add Qt Creator-style build kit management.

### Android Deployment MVP
- [x] **Detect `androiddeployqt`** in Qt installation
- [x] **`Qt: Build Android APK`** command — wraps `androiddeployqt` with basic args
- [x] **Android SDK/NDK path configuration**
- [x] **Progress notification** during APK packaging
- [x] **ADB device detection & install** — list connected devices, `adb install -r` the built APK

### Build Kit Profiles
- [x] **Auto-detect kits** from Qt installations (name, Qt version, compiler, build dir template)
- [x] **`Qt: Detect Build Kits`** command
- [x] **`Qt: Select Build Kit`** — per-project kit selection
- [x] **`Qt: Configure Build Kit`** — edit build directory template and extra args
- [x] **Per-kit build directories** — `${workspaceFolder}/build-${kitName}-${buildType}`
- [x] **Kit env vars & extra args** injected into build tasks

---

## ✅ Version 1.20.0 (Current — Shipped) — iOS, WebAssembly & Build Kit Tools

**Theme:** Extend mobile deployment to iOS and WebAssembly, enhance Android and build kit management.

### iOS Deployment MVP *(macOS only)*
- [x] **`Qt: Build iOS App`** — qmake (`-spec macx-ios-clang`) and CMake iOS toolchain builds
- [x] **`Qt: Select iOS Simulator`** — pick from `xcrun simctl list` with UDID persistence
- [x] **`Qt: Run iOS App on Simulator`** — build, install (`simctl install`), and launch (`simctl launch`)
- [x] Platform guard: graceful errors on Windows/Linux

### Qt for WebAssembly
- [x] **Detect Emscripten SDK** — search common paths + PATH fallback
- [x] **`Qt: Configure Emscripten SDK`** — interactive path picker with `emcc` version check
- [x] **`Qt: Build for WebAssembly`** — qmake with `wasm-emscripten` spec or `emcmake` + `emmake make`
- [x] **`Qt: Serve WebAssembly Preview`** — built-in Node.js HTTP server with MIME types for `.wasm`

### Android Enhancements
- [x] **`Qt: Build Android AAB`** — `androiddeployqt` with `--aab` flag
- [x] **`Qt: Validate Android Manifest`** — regex-based checks for Qt app class, configChanges, permissions, minSdkVersion

### Build Kit Enhancements
- [x] **Cross-compile prefix** — per-kit `crossCompilePrefix` (e.g., `aarch64-linux-gnu-`)
- [x] **CMake toolchain file management** — `Qt: Configure Kit Toolchain` via file picker
- [x] **Kit export/import** — `Qt: Export Build Kits` / `Qt: Import Build Kits` as JSON with deduplication
- [x] **Task provider integration** — toolchain file and cross-compile args injected into CMake/qmake build & rebuild tasks
- [x] **Fix:** Kit environment variables now passed to rebuild tasks

---

## ✅ Version 2.0.0 (Current — Shipped) — Completeness & Polish

**Theme:** Implement everything that was claimed but missing, fix known limitations, and round out the extension into a truly complete Qt development environment.

### Code Intelligence (v0.4.0 gaps)
- [x] **Context-aware Qt completions** — infer enclosing C++ class and suggest base-class methods/signals/slots
- [ ] **MOC-aware IntelliSense v2** — resolve `Q_PROPERTY` types for property-specific completions (e.g., `QString` properties offer string methods)

### Sidebar & Import (v0.5.0 gaps)
- [x] **One-click rebuild from status indicator** — add `command` to `QtStatusGroupItem` tree nodes
- [x] **Qt Creator `.pro.user` run config import** — complete `runConfiguration` parsing (executable, workingDirectory, arguments)

### Build Features (v0.6.0 gaps)
- [x] **Unnecessary rebuild detection** — compare source timestamps vs object file timestamps; warn when `make` would rebuild unchanged files
- [x] **Proactive ccache suggestion** — after a slow build, suggest enabling ccache if not already configured

### QML-C++ Bridge (v1.3.0 limitation)
- [x] **`QML_ATTACHED` support** — detect `QML_ATTACHED` macros, index attached properties, offer completions for `Type.attachedProperty` patterns

### Build Analytics (v1.14.0 gaps)
- [x] **Build time regression alerts** — compare current build time to trailing average; show warning if > 1.5x
- [ ] **Per-file compilation time breakdown** — parse build output to attribute time to individual `.cpp` files; show slowest files in analytics tree

### Code Quality (v1.18.0 gaps)
- [x] **clazy auto-fix quick actions** — `CodeActionProvider` that offers "Modernize connect()", "Add missing tr()", etc. with one-click apply
- [x] **`.clang-tidy` / `_clang-tidy` config detection** — read project-level config and pass `--config-file=` to clazy invocation

### Mobile & Deployment (v1.19.0–1.20.0 gaps)
- [x] **Android NDK auto-detection** — detect NDK from `ndk-bundle` inside SDK, `ANDROID_NDK_HOME`, or common paths
- [x] **iOS device deployment** — `xcodebuild archive` + `xcodebuild -exportArchive` for IPA export
- [ ] **iOS provisioning profile & signing** — detect profiles, select signing identity (deferred to v2.1.0)
- [x] **WebAssembly source maps** — configure `-g` and serve `.wasm.map` files from preview server
- [x] **WebAssembly threading** — detect pthread-enabled Qt WASM and configure `-sUSE_PTHREADS`

### Build Kits (v1.20.0 gaps)
- [x] **Kit validation** — `Qt: Validate Build Kit` command checks Qt path, compiler, toolchain file all exist and are compatible
- [x] **Default kit per workspace** — "Set as default for this workspace" option in kit selector
- [x] **Kit-specific deploy directories** — extend `${kitName}` variable substitution to `qt.deployDirectory`
- [x] **Kit env var editor UI** — interactive key/value editor instead of raw JSON

### General Polish
- [x] **Extension health check** — `Qt: Run Health Check` command validates Qt, compiler, debugger, and kit configs; produces a diagnostic report
- [x] **Settings migration** — auto-migrate old setting names/structures on extension update
- [ ] **Telemetry opt-in** — anonymous usage metrics (command invocations, build times) to guide future development

---

## 🚧 Version 2.1.0 — Advanced Mobile & Embedded *(Candidate)*

**Theme:** Deeper mobile integration and embedded cross-compilation workflows.

### iOS Enhancements
- [ ] **TestFlight upload** — wrap `xcrun altool` for App Store Connect uploads
- [ ] **Simulator screenshot/recording** — `xcrun simctl io` integration

### Android Enhancements
- [ ] **AAB install & test** — `bundletool` integration for local AAB testing
- [ ] **Gradle wrapper support** — use project's own Gradle instead of bundled
- [ ] **Android logcat viewer** — stream `adb logcat` filtered by Qt app PID in output channel

### Cross-Compilation & Embedded
- [ ] **Sysroot management** — per-kit sysroot path for embedded Linux
- [ ] **Remote deployment** — SCP/RSYNC built artifacts to target device
- [ ] **Remote debugging** — GDB server / LLDB remote setup with launch config generation
- [ ] **Yocto SDK detection** — auto-detect Qt installations inside Yocto SDK sysroots

---

## 🚧 Version 2.2.0 — LSP & Deep Code Intelligence *(Candidate)*

**Theme:** A Qt Language Server Protocol (LSP) client for deep C++ Qt understanding.

### Qt LSP Server
- [ ] **Custom LSP server for Qt C++**
  - Parse `moc` output to understand `Q_OBJECT` meta-information
  - Provide accurate completions for `SIGNAL()` / `SLOT()` macros
  - Resolve `connect()` overloads with type checking

### Deep Code Understanding
- [ ] **Rename refactoring** across signal/slot connections
  - Rename a signal → update all `connect()` calls and `.qml` bindings
  - Rename a `Q_PROPERTY` → update QML usages
- [ ] **Find all signal emitters** — find every `emit mySignal()` call site
- [ ] **Find all slot connections** — find every `connect(..., SLOT(mySlot()))` call

### QML-C++ Cross-Reference
- [ ] **Go to QML usage** from C++ `Q_INVOKABLE` / `Q_PROPERTY`
- [ ] **Go to C++ definition** from QML `property` or `function` call
- [ ] **Refactor QML type** — rename C++ `QML_ELEMENT` class and update all `.qml` imports

---

## How to Contribute

1. Pick an open item from the upcoming version.
2. Open an issue to discuss design if it involves new UI or user-facing behavior.
3. Submit a PR referencing the roadmap item.

> **Last updated:** June 11, 2026
> **Current version:** v2.0.0 — Completeness & Polish
> For the latest status, check the [GitHub Issues](https://github.com/akhilp19/Qt-VSC-Extension/issues) page.
