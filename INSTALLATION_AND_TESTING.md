# Qt C++ Tools VS Code Extension - Installation & Testing Guide

## ✅ Installation Complete!

The Qt C++ Tools extension has been successfully built and installed to your VS Code.

### What Was Created

Your Qt-VSC-Extension now contains:

```
Qt-VSC-Extension/
├── src/
│   ├── extension.ts              # Main extension entry point
│   ├── qtConfigManager.ts        # Qt installation detection
│   ├── qtProjectDetector.ts      # Project file scanning
│   ├── qtTaskProvider.ts         # Build task provider
│   └── index.ts                  # Exports
├── .vscode/
│   ├── launch.json              # Debug configuration
│   ├── tasks.json               # Build tasks for development
│   └── extensions.json          # Recommended extensions
├── out/                         # Compiled JavaScript (auto-generated)
├── package.json                 # Extension manifest
├── tsconfig.json               # TypeScript config
├── README.md                   # Full documentation
├── install.ps1                 # Installation script
└── qt-vsc-extension-0.0.1.vsix # Extension package (installed)
```

---

## 🚀 Getting Started

### 1. Verify Installation

Open VS Code and check:

```
1. Press Ctrl+Shift+P (or Cmd+Shift+P on Mac)
2. Type: @installed
3. Search for "Qt C++ Tools"
4. You should see: "Qt C++ Tools - Build, run and manage Qt C++ projects"
```

### 2. Test with a Sample Qt Project

**Option A: Create a Simple Test Project**

```bash
# Create a test directory
mkdir test-qt-project
cd test-qt-project

# Create a simple .pro file
cat > MyApp.pro << 'EOF'
QT += core gui
TARGET = MyApp
TEMPLATE = app

SOURCES += main.cpp
HEADERS += mainwindow.h
INCLUDEPATH += .

CONFIG += c++17
EOF

# Create main.cpp
cat > main.cpp << 'EOF'
#include <QApplication>
#include <QMainWindow>

int main(int argc, char *argv[])
{
    QApplication app(argc, argv);
    QMainWindow window;
    window.setWindowTitle("Qt Test App");
    window.show();
    return app.exec();
}
EOF

# Create mainwindow.h
cat > mainwindow.h << 'EOF'
#ifndef MAINWINDOW_H
#define MAINWINDOW_H
#include <QMainWindow>
class MainWindow : public QMainWindow { Q_OBJECT };
#endif
EOF
```

**Option B: Use Your Existing Qt Project**

Just open any folder with `.pro` or `CMakeLists.txt` files in VS Code.

### 3. Available Commands

Press `Ctrl+Shift+P` and type `Qt:` to see all available commands:

#### Build Commands
- **Qt: Build Project** - Compile your Qt project
- **Qt: Clean Project** - Remove build artifacts
- **Qt: Rebuild Project** - Clean and rebuild
- **Qt: Run Project** - Execute the built application

#### Configuration Commands
- **Qt: Configure Qt Installation Path** - Manually set qmake path
- **Qt: Select Qt Version** - Choose from detected Qt installations

#### Project Creation (Coming Soon)
- **Qt: Create New QMake Project** - Wizard for new QMake projects
- **Qt: Create New CMake Project** - Wizard for new CMake projects

---

## 🔧 Configuration

### Auto-Detection (Recommended)

The extension automatically detects Qt by searching:

1. User configuration (`qt.qmakePath` or `qt.qtInstallPath`)
2. `QTDIR` environment variable
3. System PATH
4. Common installation directories:
   - `C:\Qt` (Windows)
   - `C:\Program Files\Qt`
   - `%USERPROFILE%\Qt`

If auto-detection doesn't work:

### Manual Configuration

1. Press `Ctrl+,` to open Settings
2. Search for "qt.qmakePath"
3. Set to your qmake.exe path:

```json
{
  "qt.qmakePath": "C:\\Qt\\6.5.0\\msvc2019_64\\bin\\qmake.exe"
}
```

Or use the command:
```
Qt: Configure Qt Installation Path
```

### All Configuration Options

```json
{
  // Path to qmake executable
  "qt.qmakePath": "",
  
  // Qt installation directory
  "qt.qtInstallPath": "",
  
  // Auto-detect Qt projects
  "qt.autoDetect": "on",
  
  // Build output directory
  "qt.buildDirectory": "${workspaceFolder}/build",
  
  // Default build type: debug or release
  "qt.defaultBuildType": "debug",
  
  // Make command: auto, nmake, mingw32-make, jom, make
  "qt.makeCommand": "auto",
  
  // Additional qmake arguments
  "qt.additionalQMakeArguments": "",
  
  // Additional CMake arguments
  "qt.additionalCMakeArguments": "",
  
  // Show build output
  "qt.showBuildOutput": true,
  
  // Clear output before build
  "qt.clearOutputBeforeBuild": true
}
```

---

## 🧪 Testing the Extension

### Test 1: Project Detection

1. Open a folder with `.pro` or `CMakeLists.txt` files
2. Open Output panel: `View` → `Output`
3. Select "Qt C++ Tools" from dropdown
4. You should see: `Found X Qt project(s)`

### Test 2: Build Process

1. Open a Qt project folder
2. Press `Ctrl+Shift+P` → `Qt: Build Project`
3. Watch the build output in the integrated terminal
4. Check output channel for detailed logs

### Test 3: Task Provider

1. Press `Ctrl+Shift+B` (or `Cmd+Shift+B` on Mac)
2. Select a Qt task (Build, Clean, Rebuild, Run)
3. Task should execute in the terminal

### Test 4: Configuration

1. Press `Ctrl+Shift+P` → `Qt: Configure Qt Installation Path`
2. Navigate to your qmake.exe
3. Verify in settings: `Ctrl+,` → search "qmakePath"

### Test 5: Command Palette

1. Press `Ctrl+Shift+P`
2. Type "Qt:"
3. Verify all 8 commands appear:
   - Qt: Build Project
   - Qt: Clean Project
   - Qt: Rebuild Project
   - Qt: Run Project
   - Qt: Configure Qt Installation Path
   - Qt: Select Qt Version
   - Qt: Create New QMake Project
   - Qt: Create New CMake Project

---

## 📝 Supported Project Types

### ✅ QMake Projects (.pro files)

**Detected by:** Finding `.pro` files

**Builds with:**
- qmake (generate Makefile)
- nmake or mingw32-make (compile)

**Example structure:**
```
MyApp.pro
src/
  main.cpp
include/
  mainwindow.h
```

### ✅ CMake Qt Projects (CMakeLists.txt)

**Detected by:** Files containing:
- `find_package(Qt5 ...)` or `find_package(Qt6 ...)`
- `CMAKE_AUTOMOC ON`, `CMAKE_AUTOUIC ON`, `CMAKE_AUTORCC ON`
- `qt5_wrap_cpp`, `qt6_wrap_cpp`, etc.

**Builds with:**
- cmake (generate build files)
- cmake --build (compile)

**Example:**
```cmake
cmake_minimum_required(VERSION 3.16)
project(MyQtApp)

set(CMAKE_AUTOMOC ON)
find_package(Qt6 REQUIRED COMPONENTS Widgets)

add_executable(MyApp main.cpp)
target_link_libraries(MyApp Qt6::Widgets)
```

---

## 🐛 Troubleshooting

### Problem: "No Qt project found"

**Solution:**
- Ensure `.pro` or `CMakeLists.txt` exists in workspace
- Check Output → Qt C++ Tools for detection logs
- Make sure project files match the patterns

### Problem: "Qt installation not found"

**Solution:**
1. Install Qt from https://www.qt.io/download
2. Use `Qt: Configure Qt Installation Path` command
3. Or set in settings:
   ```json
   {
     "qt.qmakePath": "C:\\Qt\\6.5.0\\msvc2019_64\\bin\\qmake.exe"
   }
   ```

### Problem: Build fails with compiler errors

**Solution:**
- Verify MSVC is installed (if using MSVC)
  - Open VS Code from "Developer Command Prompt"
- For MinGW: Ensure qmake from MinGW build is used
- Check Output channel for specific error messages
- Build directory must be writable

### Problem: "No problems match..." error

**Solution:**
- This is a problem matcher issue, not a build failure
- Check if executable was created in build directory
- Run task with `Qt: Run Project` to test executable

### Problem: Multiple Qt versions detected

**Solution:**
- Use `Qt: Select Qt Version` command
- Or manually set in settings:
   ```json
   {
     "qt.qtInstallPath": "C:\\Qt\\6.5.0\\msvc2019_64"
   }
   ```

### Problem: CMake build not working

**Solution:**
- Ensure CMake is installed: `cmake --version`
- Check if CMakeLists.txt uses proper Qt syntax
- Verify build directory path in settings

---

## 🔄 For Development

### Launch Extension in Debug Mode

1. Open this workspace in VS Code
2. Press `F5` to launch "Extension Development Host"
3. A new VS Code window opens with the extension loaded
4. Test in the new window
5. Changes to source files require recompiling: `npm run compile`

### Build Commands

```bash
# Compile TypeScript to JavaScript
npm run compile

# Watch mode (auto-recompile on save)
npm run watch

# Package into .vsix file
npm run package

# Install from .vsix
code --install-extension qt-vsc-extension-0.0.1.vsix --force
```

### Re-install After Changes

```bash
npm run compile
npx @vscode/vsce package --no-git-tag-version
code --install-extension qt-vsc-extension-0.0.1.vsix --force
```

---

## 📚 Project Structure

```
src/
├── extension.ts
│   ├── activate() - Extension initialization
│   ├── deactivate() - Cleanup
│   ├── executeQtTask() - Execute build/clean/rebuild/run
│   ├── configureQtPath() - Manual Qt path setup
│   ├── selectQtVersion() - Multi-version selection
│   └── createQMakeProject() - Project creation (stub)
│
├── qtConfigManager.ts
│   ├── getQtInstallation() - Get current Qt setup
│   ├── detectQtInstallation() - Auto-detect Qt
│   ├── findQtInstallations() - Find all Qt versions
│   ├── getMakeCommand() - Determine make tool (MSVC/MinGW)
│   └── getBuildDirectory() - Get build output path
│
├── qtProjectDetector.ts
│   ├── detectProjects() - Find all Qt projects
│   ├── getProjectInfo() - Analyze project file
│   ├── parseQMakeProject() - Parse .pro files
│   ├── parseCMakeProject() - Parse CMakeLists.txt
│   └── findExecutable() - Locate built executable
│
└── qtTaskProvider.ts
    ├── provideTasks() - Generate available tasks
    ├── resolveTask() - Resolve incomplete task
    ├── createBuildTask() - qmake/cmake build
    ├── createCleanTask() - Clean artifacts
    ├── createRebuildTask() - Clean + rebuild
    └── createRunTask() - Execute application
```

---

## 🎯 Next Steps / Roadmap

### Phase 1: ✅ Core Build System
- [x] QMake project detection
- [x] CMake project detection
- [x] Build, Clean, Rebuild tasks
- [x] Run executable command
- [x] Qt installation auto-detection
- [x] MSVC/MinGW toolchain support

### Phase 2: 🔄 Project Creation
- [ ] QMake project wizard
- [ ] CMake project wizard
- [ ] Project templates
- [ ] Subdirectory projects

### Phase 3: 🔄 Integration Features
- [ ] Qt Designer (.ui) support
- [ ] Resource file (.qrc) support
- [ ] Deployment (windeployqt)
- [ ] IntelliSense configuration

### Phase 4: 🔄 Platform Support
- [ ] macOS support
- [ ] Linux support
- [ ] Cross-compilation

---

## 📞 Support & Feedback

- **Report Issues**: Open an issue on GitHub
- **Check Logs**: View → Output → Qt C++ Tools
- **Configuration Help**: Check all settings with `qt.*` prefix

---

## 📄 License

MIT License - See LICENSE file

---

**Happy Qt Development! 🚀**

Created: January 4, 2026  
Version: 0.0.1  
Author: Akhil Pawar
