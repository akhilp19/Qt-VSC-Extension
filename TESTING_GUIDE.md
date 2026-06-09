# Qt C++ Tools Extension - Complete Testing Guide

## 🎯 Verify Installation

### Step 1: Check Extension is Installed

```
1. Open VS Code
2. Press Ctrl+Shift+X (Extensions)
3. Search: "qt c++"
4. Should show: "Qt C++ Tools" by akhilpawar
5. Status should be: "Installed"
```

### Step 2: Check Extension Folder

```
C:\Users\Akhil\.vscode\extensions\akhilpawar.qt-vsc-extension-0.0.1\
```

Should contain:
- ✅ extension.vsixmanifest
- ✅ package.json
- ✅ README.md
- ✅ out/extension.js (and other .js files)

---

## 🧪 Test 1: Basic Command Registration

**Objective:** Verify all 8 commands are registered

### Procedure

1. Press `Ctrl+Shift+P` (Command Palette)
2. Type `Qt:`
3. You should see:
   ```
   Qt: Build Project
   Qt: Clean Project
   Qt: Rebuild Project
   Qt: Run Project
   Qt: Configure Qt Installation Path
   Qt: Select Qt Version
   Qt: Create New QMake Project
   Qt: Create New CMake Project
   ```

### Expected Result
✅ All 8 commands appear in the list

---

## 🧪 Test 2: Qt Installation Detection

**Objective:** Verify Qt can be detected automatically

### Procedure

1. Open Output panel: `View` → `Output`
2. Select "Qt C++ Tools" from dropdown
3. You should see messages like:
   ```
   Qt C++ Tools extension initialized successfully
   Detecting Qt installation...
   Found qmake via QTDIR: ...
   ```

### Expected Result
✅ One of these appears:
- "Using configured qmake: ..."
- "Found qmake via QTDIR: ..."
- "Found qmake in PATH: ..."
- "Found Qt installation: ..."
- "No Qt installation found"

---

## 🧪 Test 3: Project Detection (QMake)

**Objective:** Verify .pro files are detected

### Procedure

1. Create test directory with sample .pro file:
   ```bash
   mkdir C:\Temp\qt-test
   cd C:\Temp\qt-test
   ```

2. Create `SimpleApp.pro`:
   ```qmake
   QT += core gui
   TARGET = SimpleApp
   TEMPLATE = app
   
   SOURCES += main.cpp
   HEADERS += main.h
   ```

3. Create `main.cpp`:
   ```cpp
   #include <QApplication>
   #include <QWidget>
   
   int main(int argc, char *argv[])
   {
       QApplication app(argc, argv);
       QWidget window;
       window.setWindowTitle("Qt Test");
       window.show();
       return app.exec();
   }
   ```

4. Create `main.h`:
   ```cpp
   #ifndef MAIN_H
   #define MAIN_H
   #include <QWidget>
   #endif
   ```

5. In VS Code:
   - `File` → `Open Folder`
   - Select `C:\Temp\qt-test`
   - Open Output → Qt C++ Tools

6. Look for:
   ```
   Found 1 Qt project(s)
     - C:\Temp\qt-test\SimpleApp.pro
   ```

### Expected Result
✅ .pro file is detected and logged

---

## 🧪 Test 4: Project Detection (CMake)

**Objective:** Verify CMakeLists.txt is detected

### Procedure

1. Create another test directory:
   ```bash
   mkdir C:\Temp\qt-cmake-test
   cd C:\Temp\qt-cmake-test
   ```

2. Create `CMakeLists.txt`:
   ```cmake
   cmake_minimum_required(VERSION 3.16)
   project(QtCMakeTest)
   
   set(CMAKE_CXX_STANDARD 17)
   set(CMAKE_AUTOMOC ON)
   
   find_package(Qt6 REQUIRED COMPONENTS Widgets)
   
   add_executable(QtApp main.cpp)
   target_link_libraries(QtApp Qt6::Widgets)
   ```

3. Create `main.cpp` (same as above)

4. In VS Code:
   - `File` → `Open Folder`
   - Select `C:\Temp\qt-cmake-test`
   - Open Output → Qt C++ Tools

5. Look for:
   ```
   Found 1 Qt project(s)
     - C:\Temp\qt-cmake-test\CMakeLists.txt
   ```

### Expected Result
✅ CMakeLists.txt is detected

---

## 🧪 Test 5: QMake Build Task Generation

**Objective:** Verify build tasks are created for .pro projects

### Procedure

1. Open the QMake test project (from Test 3)
2. Press `Ctrl+Shift+B` (Run Task)
3. You should see:
   ```
   Build SimpleApp
   Clean SimpleApp
   Rebuild SimpleApp
   Run SimpleApp
   ```

4. Select "Build SimpleApp"
5. Monitor output in terminal

### Expected Result
✅ Tasks appear with project name
✅ Task execution starts (may fail if Qt not properly installed, but command should run)

---

## 🧪 Test 6: Qt Path Configuration

**Objective:** Verify manual Qt path configuration works

### Procedure

1. Press `Ctrl+Shift+P`
2. Type `Qt: Configure Qt Installation Path`
3. If you have Qt installed:
   - Navigate to `C:\Qt\<version>\<compiler>\bin\qmake.exe`
   - Select qmake.exe
4. If no Qt installed:
   - Click Cancel or select any .exe file

### Expected Result
✅ Command completes without error
✅ Configuration is saved to workspace settings
✅ Can verify in settings: `Ctrl+,` search "qt.qmakePath"

---

## 🧪 Test 7: Qt Version Selection

**Objective:** Verify Qt version selection works

### Procedure

1. Press `Ctrl+Shift+P`
2. Type `Qt: Select Qt Version`
3. If Qt installations found:
   - Quick Pick menu appears with versions
   - Can select one
4. If no Qt found:
   - Error message appears

### Expected Result
✅ Command completes
✅ UI response (menu or error message)

---

## 🧪 Test 8: Settings Validation

**Objective:** Verify all settings are accessible and editable

### Procedure

1. Press `Ctrl+,` (Settings)
2. Search for "qt."
3. Should see all 11 settings:
   - qt.qmakePath
   - qt.qtInstallPath
   - qt.autoDetect
   - qt.buildDirectory
   - qt.defaultBuildType
   - qt.makeCommand
   - qt.additionalQMakeArguments
   - qt.additionalCMakeArguments
   - qt.showBuildOutput
   - qt.clearOutputBeforeBuild

4. Try editing one (e.g., qt.defaultBuildType)

### Expected Result
✅ All settings visible and editable
✅ Changes persist in settings.json

---

## 🧪 Test 9: Output Channel

**Objective:** Verify logging works

### Procedure

1. Open Output: `View` → `Output`
2. Select "Qt C++ Tools" from dropdown
3. You should see:
   ```
   Qt C++ Tools extension is now active!
   Qt C++ Tools extension initialized successfully
   Detecting Qt installation...
   ... (detection logs)
   ```

4. Trigger a command and watch for logs:
   - Press `Ctrl+Shift+P` → `Qt: Build Project`
   - Logs appear in output channel

### Expected Result
✅ Output channel contains initialization logs
✅ Command execution produces logs

---

## 🧪 Test 10: Multi-Root Workspace

**Objective:** Verify extension works with multiple folders

### Procedure

1. Create two folders with Qt projects:
   ```
   C:\Temp\project1\  (with .pro file)
   C:\Temp\project2\  (with CMakeLists.txt)
   ```

2. In VS Code:
   - `File` → `Open Folder`
   - On first dialog, select C:\Temp\project1\
   - Then: `File` → `Add Folder to Workspace`
   - Add C:\Temp\project2\

3. Check Output → Qt C++ Tools
4. Should see both projects detected

### Expected Result
✅ Both projects listed
✅ Tasks created for both projects
✅ Can build either project

---

## 🎯 Full Integration Test

**Objective:** Complete workflow test

### Prerequisites
- Qt 5.x or 6.x installed
- MinGW or MSVC compiler available

### Procedure

1. Create a working Qt project with:
   ```bash
   mkdir C:\Temp\final-test
   cd C:\Temp\final-test
   # Add real .pro file with working C++ code
   ```

2. In VS Code:
   ```
   File → Open Folder → C:\Temp\final-test
   ```

3. Step through:
   - Ctrl+Shift+P → Qt: Build Project
   - Watch build output in terminal
   - Check for errors in Problems panel
   - Run executable: Qt: Run Project
   - See application launch

### Expected Result
✅ Project builds successfully
✅ Executable runs
✅ No error messages

---

## ❌ Error Handling Tests

### Test: Invalid Qt Path

1. Settings: `Ctrl+,` → `qt.qmakePath`
2. Set to invalid path: `C:\fake\path\qmake.exe`
3. Open Output → Qt C++ Tools
4. Should see error message

**Expected:** ✅ Error logged, extension handles gracefully

### Test: No Qt Projects

1. Open empty folder
2. Check Output → Qt C++ Tools
3. Try command: Ctrl+Shift+P → Qt: Build Project

**Expected:** ✅ Error message "No Qt project found"

### Test: Missing Compiler

1. If no MSVC installed, try building QMake project
2. Check terminal output

**Expected:** ✅ Compiler error appears in Problems panel

---

## 📊 Test Report Template

```
Date: _________
Tester: _________
Platform: Windows
Qt Version(s): _________

Test Results:
- [ ] Test 1: Command Registration ___/10
- [ ] Test 2: Qt Detection ___/10
- [ ] Test 3: QMake Detection ___/10
- [ ] Test 4: CMake Detection ___/10
- [ ] Test 5: Task Generation ___/10
- [ ] Test 6: Qt Configuration ___/10
- [ ] Test 7: Version Selection ___/10
- [ ] Test 8: Settings ___/10
- [ ] Test 9: Output Channel ___/10
- [ ] Test 10: Multi-Root ___/10

Overall Score: __/100

Issues Found:
1. _________
2. _________

Notes:
_________
```

---

## ✅ Completion Checklist

After all tests pass, verify:

- [ ] All 8 commands registered
- [ ] Output channel working
- [ ] Settings accessible
- [ ] Qt auto-detection functional
- [ ] .pro files detected
- [ ] CMakeLists.txt detected
- [ ] Tasks created properly
- [ ] Build execution works
- [ ] Error handling graceful
- [ ] No console errors

---

## 🐛 Debugging Tips

### Enable Verbose Logging

Add to settings:
```json
{
  "qt.logLevel": "debug"  // When implemented
}
```

### Check VS Code Debug Console

Open Debug Console: `Ctrl+Shift+Y`
- Should see minimal output
- Check for exceptions

### Check Extension Logs

```
C:\Users\Akhil\.vscode\extensions\
  akhilpawar.qt-vsc-extension-0.0.1\
```

Look for any generated log files.

### Run Extension in Debug Mode

1. Open this workspace in VS Code
2. Press F5 to launch Extension Development Host
3. In new window, test the extension
4. Set breakpoints in source code

---

## 📞 Known Limitations (Phase 1)

1. ⚠️ Project creation wizards not implemented
2. ⚠️ Qt Designer integration pending
3. ⚠️ Only Windows support (macOS/Linux coming)
4. ⚠️ Limited UI customization
5. ⚠️ No deployment utilities yet

---

## ✨ Success Criteria

**The extension is working correctly if:**

✅ All commands appear in Command Palette  
✅ Qt installations are detected  
✅ Qt projects (.pro and CMakeLists.txt) are found  
✅ Build tasks are created  
✅ Output channel shows meaningful logs  
✅ Settings can be configured  
✅ No exceptions in Debug Console  

**If all above pass: Implementation is successful! 🎉**

---

**Testing Complete!**

Report any issues or missing functionality via GitHub Issues.

Good luck with your Qt C++ development in VS Code! 🚀
