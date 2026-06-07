import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';

export type ProjectType = 'widgets-app' | 'console-app' | 'quick-app' | 'static-lib' | 'shared-lib';

export interface ProjectTypeOption {
    label: string;
    value: ProjectType;
    description: string;
}

export interface QtModuleOption {
    label: string;
    value: string;
    description: string;
    picked?: boolean;
}

export const PROJECT_TYPES: ProjectTypeOption[] = [
    { label: 'Qt Widgets Application', value: 'widgets-app', description: 'Desktop GUI application with Qt Widgets' },
    { label: 'Qt Console Application', value: 'console-app', description: 'Command-line application' },
    { label: 'Qt Quick Application', value: 'quick-app', description: 'Modern QML-based application' },
    { label: 'Static Library', value: 'static-lib', description: 'Statically linked library' },
    { label: 'Shared Library', value: 'shared-lib', description: 'Dynamically linked library (DLL)' }
];

export const QT_MODULES: QtModuleOption[] = [
    { label: 'Core', value: 'core', description: 'Qt Core module', picked: true },
    { label: 'Gui', value: 'gui', description: 'Qt GUI module', picked: true },
    { label: 'Widgets', value: 'widgets', description: 'Qt Widgets module' },
    { label: 'Quick', value: 'quick', description: 'Qt Quick (QML) module' },
    { label: 'Quick Controls 2', value: 'quickcontrols2', description: 'Qt Quick Controls 2 module' },
    { label: 'Network', value: 'network', description: 'Qt Network module' },
    { label: 'Sql', value: 'sql', description: 'Qt SQL module' },
    { label: 'Xml', value: 'xml', description: 'Qt XML module' },
    { label: 'Test', value: 'testlib', description: 'Qt Test module' },
    { label: 'Multimedia', value: 'multimedia', description: 'Qt Multimedia module' }
];

export interface ProjectTemplateOptions {
    projectName: string;
    projectType: ProjectType;
    modules: string[];
    qtVersion: 'qt5' | 'qt6';
    includeWindowClass: boolean;
}

export interface GeneratedFile {
    fileName: string;
    content: string;
}

function getModuleQtName(module: string): string {
    // QMake uses lowercase module names
    return module.toLowerCase();
}

function getModuleCMakeName(module: string): string {
    // CMake uses capitalized component names
    const map: Record<string, string> = {
        'core': 'Core',
        'gui': 'Gui',
        'widgets': 'Widgets',
        'quick': 'Quick',
        'quickcontrols2': 'QuickControls2',
        'network': 'Network',
        'sql': 'Sql',
        'xml': 'Xml',
        'testlib': 'Test',
        'multimedia': 'Multimedia'
    };
    return map[module.toLowerCase()] || module;
}

/**
 * Generate QMake project files
 */
export function generateQMakeProject(options: ProjectTemplateOptions): GeneratedFile[] {
    const files: GeneratedFile[] = [];
    const { projectName, projectType, modules, includeWindowClass } = options;

    const qtModules = modules.map(getModuleQtName).join(' ');

    // Determine template and config
    let template = 'app';
    let config = 'c++17';
    let targetType = 'app';

    if (projectType === 'static-lib') {
        template = 'lib';
        config = 'c++17 staticlib';
        targetType = 'lib';
    } else if (projectType === 'shared-lib') {
        template = 'lib';
        config = 'c++17 shared';
        targetType = 'lib';
    } else if (projectType === 'console-app') {
        config = 'c++17 console';
    }

    // Generate .pro file
    const proContent = `QT += ${qtModules}
CONFIG += ${config}

TARGET = ${projectName}
TEMPLATE = ${template}

SOURCES += \\
    ${getMainSourceFile(projectType, includeWindowClass)}${targetType === 'lib' ? ` \\
    ${projectName.toLowerCase()}.cpp` : ''}
${targetType === 'app' && projectType === 'widgets-app' && includeWindowClass ? `
HEADERS += \\
    ${projectName.toLowerCase()}.h

FORMS += \\
    ${projectName.toLowerCase()}.ui
` : ''}${projectType === 'quick-app' ? `
DISTFILES += \\
    main.qml
` : ''}
# Default rules for deployment.
qnx: target.path = /tmp/$$TARGET/bin
else: unix:!android: target.path = /opt/$$TARGET/bin
!isEmpty(target.path): INSTALLS += target
`;

    files.push({ fileName: `${projectName}.pro`, content: proContent.trim() + '\n' });

    // Generate source files
    if (targetType === 'app') {
        files.push({ fileName: getMainSourceFile(projectType, includeWindowClass), content: generateMainCpp(projectName, projectType, includeWindowClass) });
        if (projectType === 'widgets-app' && includeWindowClass) {
            files.push({ fileName: `${projectName.toLowerCase()}.h`, content: generateWindowHeader(projectName) });
            files.push({ fileName: `${projectName.toLowerCase()}.cpp`, content: generateWindowCpp(projectName) });
            files.push({ fileName: `${projectName.toLowerCase()}.ui`, content: generateWindowUi(projectName) });
        }
        if (projectType === 'quick-app') {
            files.push({ fileName: 'main.qml', content: generateMainQml() });
        }
    } else {
        // Library
        files.push({ fileName: `${projectName.toLowerCase()}.h`, content: generateLibHeader(projectName) });
        files.push({ fileName: `${projectName.toLowerCase()}.cpp`, content: generateLibCpp(projectName) });
    }

    return files;
}

/**
 * Generate CMake project files
 */
export function generateCMakeProject(options: ProjectTemplateOptions): GeneratedFile[] {
    const files: GeneratedFile[] = [];
    const { projectName, projectType, modules, qtVersion } = options;

    const cmakeModules = modules.map(getModuleCMakeName);
    const qtPackage = qtVersion === 'qt6' ? 'Qt6' : 'Qt5';
    const qtMajor = qtVersion === 'qt6' ? '6' : '5';

    let targetType = 'add_executable';
    let targetArgs = '';
    if (projectType === 'static-lib') {
        targetType = 'add_library';
        targetArgs = ' STATIC';
    } else if (projectType === 'shared-lib') {
        targetType = 'add_library';
        targetArgs = ' SHARED';
    }

    const isApp = projectType !== 'static-lib' && projectType !== 'shared-lib';
    const isWidgets = projectType === 'widgets-app';
    const isQuick = projectType === 'quick-app';

    const mainFile = getMainSourceFile(projectType, false);
    const sourceFiles = [mainFile];
    if (!isApp) {
        sourceFiles.push(`${projectName.toLowerCase()}.cpp`);
    }

    const cmakeContent = `cmake_minimum_required(VERSION 3.16)
project(${projectName} LANGUAGES CXX)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_AUTOMOC ON)
set(CMAKE_AUTORCC ON)
set(CMAKE_AUTOUIC ON)

find_package(${qtPackage} REQUIRED COMPONENTS ${cmakeModules.join(' ')})

${targetType}(${projectName}${targetArgs}
    ${sourceFiles.join('\n    ')}
)

target_link_libraries(${projectName} PRIVATE
    ${cmakeModules.map(m => `${qtPackage}::${m}`).join('\n    ')}
)
${isQuick ? `
# Copy QML files to build directory
set(QML_FILES
    main.qml
)

foreach(qml_file \${QML_FILES})
    configure_file(\${qml_file} \${qml_file} COPYONLY)
endforeach()
` : ''}
include(GNUInstallDirs)
install(TARGETS ${projectName}
    BUNDLE DESTINATION .
    RUNTIME DESTINATION \${CMAKE_INSTALL_BINDIR}
    LIBRARY DESTINATION \${CMAKE_INSTALL_LIBDIR}
    ARCHIVE DESTINATION \${CMAKE_INSTALL_LIBDIR}
)
`;

    files.push({ fileName: 'CMakeLists.txt', content: cmakeContent.trim() + '\n' });

    // Generate source files
    if (isApp) {
        files.push({ fileName: mainFile, content: generateMainCpp(projectName, projectType, false) });
        if (isQuick) {
            files.push({ fileName: 'main.qml', content: generateMainQml() });
        }
    } else {
        files.push({ fileName: `${projectName.toLowerCase()}.h`, content: generateLibHeader(projectName) });
        files.push({ fileName: `${projectName.toLowerCase()}.cpp`, content: generateLibCpp(projectName) });
    }

    return files;
}

function getMainSourceFile(projectType: ProjectType, includeWindowClass: boolean): string {
    if (projectType === 'console-app') {
        return 'main.cpp';
    }
    return 'main.cpp';
}

function generateMainCpp(projectName: string, projectType: ProjectType, includeWindowClass: boolean): string {
    if (projectType === 'widgets-app') {
        if (includeWindowClass) {
            return `#include "${projectName.toLowerCase()}.h"
#include <QApplication>

int main(int argc, char *argv[])
{
    QApplication a(argc, argv);
    ${projectName} w;
    w.show();
    return a.exec();
}
`;
        }
        return `#include <QApplication>
#include <QWidget>

int main(int argc, char *argv[])
{
    QApplication a(argc, argv);
    QWidget w;
    w.setWindowTitle(QStringLiteral("${projectName}"));
    w.resize(800, 600);
    w.show();
    return a.exec();
}
`;
    }

    if (projectType === 'console-app') {
        return `#include <QCoreApplication>
#include <QDebug>

int main(int argc, char *argv[])
{
    QCoreApplication a(argc, argv);

    qDebug() << "Hello from ${projectName}!";

    return a.exec();
}
`;
    }

    if (projectType === 'quick-app') {
        return `#include <QGuiApplication>
#include <QQmlApplicationEngine>

int main(int argc, char *argv[])
{
    QGuiApplication app(argc, argv);

    QQmlApplicationEngine engine;
    const QString qmlPath = QCoreApplication::applicationDirPath() + QStringLiteral("/main.qml");
    engine.load(QUrl::fromLocalFile(qmlPath));
    if (engine.rootObjects().isEmpty())
        return -1;

    return app.exec();
}
`;
    }

    // Library main (not typically used, but provide a placeholder)
    return `// ${projectName} library
`;
}

function generateWindowHeader(projectName: string): string {
    const guard = `${projectName.toUpperCase()}_H`;
    return `#ifndef ${guard}
#define ${guard}

#include <QMainWindow>

QT_BEGIN_NAMESPACE
namespace Ui { class ${projectName}; }
QT_END_NAMESPACE

class ${projectName} : public QMainWindow
{
    Q_OBJECT

public:
    ${projectName}(QWidget *parent = nullptr);
    ~${projectName}();

private:
    Ui::${projectName} *ui;
};

#endif // ${guard}
`;
}

function generateWindowCpp(projectName: string): string {
    return `#include "${projectName.toLowerCase()}.h"
#include "ui_${projectName.toLowerCase()}.h"

${projectName}::${projectName}(QWidget *parent)
    : QMainWindow(parent)
    , ui(new Ui::${projectName})
{
    ui->setupUi(this);
}

${projectName}::~${projectName}()
{
    delete ui;
}
`;
}

function generateWindowUi(projectName: string): string {
    return `<?xml version="1.0" encoding="UTF-8"?>
<ui version="4.0">
 <class>${projectName}</class>
 <widget class="QMainWindow" name="${projectName}">
  <property name="geometry">
   <rect>
    <x>0</x>
    <y>0</y>
    <width>800</width>
    <height>600</height>
   </rect>
  </property>
  <property name="windowTitle">
   <string>${projectName}</string>
  </property>
  <widget class="QWidget" name="centralwidget"/>
  <widget class="QMenuBar" name="menubar"/>
  <widget class="QStatusBar" name="statusbar"/>
 </widget>
 <resources/>
 <connections/>
</ui>
`;
}

function generateMainQml(): string {
    return `import QtQuick
import QtQuick.Controls

ApplicationWindow {
    visible: true
    width: 800
    height: 600
    title: qsTr("Hello Qt Quick")

    Label {
        anchors.centerIn: parent
        text: qsTr("Hello from Qt Quick!")
        font.pixelSize: 24
    }
}
`;
}

function generateLibHeader(projectName: string): string {
    const guard = `${projectName.toUpperCase()}_H`;
    const exportMacro = `${projectName.toUpperCase()}_EXPORT`;
    return `#ifndef ${guard}
#define ${guard}

#include <QtGlobal>

#if defined(${projectName.toUpperCase()}_LIBRARY)
#  define ${exportMacro} Q_DECL_EXPORT
#else
#  define ${exportMacro} Q_DECL_IMPORT
#endif

class ${exportMacro} ${projectName}
{
public:
    ${projectName}();
    void sayHello();
};

#endif // ${guard}
`;
}

function generateLibCpp(projectName: string): string {
    return `#include "${projectName.toLowerCase()}.h"
#include <QDebug>

${projectName}::${projectName}()
{
}

void ${projectName}::sayHello()
{
    qDebug() << "Hello from ${projectName} library!";
}
`;
}

/**
 * Write generated files to disk, creating subdirectories if needed.
 * Returns the list of created file paths.
 */
export async function writeProjectFiles(
    targetDirectory: string,
    files: GeneratedFile[],
    outputChannel: vscode.OutputChannel
): Promise<string[]> {
    const created: string[] = [];

    // Ensure target directory exists
    if (!fs.existsSync(targetDirectory)) {
        fs.mkdirSync(targetDirectory, { recursive: true });
    }

    for (const file of files) {
        const filePath = path.join(targetDirectory, file.fileName);

        // Check for overwrite
        if (fs.existsSync(filePath)) {
            const answer = await vscode.window.showWarningMessage(
                `File already exists: ${file.fileName}. Overwrite?`,
                'Yes', 'No', 'Yes to All'
            );
            if (answer === 'No') {
                outputChannel.appendLine(`Skipped existing file: ${filePath}`);
                continue;
            }
            if (answer === 'Yes to All') {
                // Write all remaining without asking
            }
        }

        fs.writeFileSync(filePath, file.content, 'utf-8');
        created.push(filePath);
        outputChannel.appendLine(`Created: ${filePath}`);
    }

    return created;
}
