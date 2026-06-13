import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { QtConfigManager } from './qtConfigManager';
import { QtProjectDetector } from './qtProjectDetector';
import { QtCMakePresets } from './qtCMakePresets';
import { QtBuildKitManager } from './qtBuildKit';
import { QtBuildPseudoterminal } from './qtBuildTerminal';
import {
    isWindows,
    mkdirCmd,
    cdCmd,
    execCmd,
    simpleExecCmd,
    ifDirExistsCmd,
    rmDirCmd,
    nullRedirect,
    joinCmds,
    quotePath
} from './platformUtils';

export class QtTaskProvider implements vscode.TaskProvider {
    private qtConfigManager: QtConfigManager;
    private qtProjectDetector: QtProjectDetector;
    private qtCMakePresets: QtCMakePresets;
    private qtBuildKitManager?: QtBuildKitManager;
    private outputChannel: vscode.OutputChannel;
    
    constructor(
        qtConfigManager: QtConfigManager,
        qtProjectDetector: QtProjectDetector,
        outputChannel: vscode.OutputChannel,
        qtBuildKitManager?: QtBuildKitManager
    ) {
        this.qtConfigManager = qtConfigManager;
        this.qtProjectDetector = qtProjectDetector;
        this.qtCMakePresets = new QtCMakePresets(outputChannel);
        this.qtBuildKitManager = qtBuildKitManager;
        this.outputChannel = outputChannel;
    }
    
    /**
     * Provide tasks for all Qt projects in workspace
     */
    async provideTasks(token: vscode.CancellationToken): Promise<vscode.Task[]> {
        const tasks: vscode.Task[] = [];
        
        const workspaceFolders = vscode.workspace.workspaceFolders;
        if (!workspaceFolders) {
            return tasks;
        }
        
        for (const folder of workspaceFolders) {
            const projects = await this.qtProjectDetector.detectProjects(folder.uri.fsPath);
            
            for (const projectFile of projects) {
                const projectInfo = await this.qtProjectDetector.getProjectInfo(projectFile);
                if (!projectInfo) {
                    continue;
                }
                
                // Create build, clean, rebuild, quick build, and run tasks for each project
                if (projectInfo.type === 'python') {
                    // Python Qt projects only need run tasks
                    tasks.push(await this.createRunTask(projectFile, projectInfo.type, folder));
                } else if (projectInfo.type === 'raw') {
                    tasks.push(await this.createRawBuildTask(projectInfo.directory, folder));
                    tasks.push(await this.createRawCleanTask(projectInfo.directory, folder));
                    tasks.push(await this.createRawRunTask(projectInfo.directory, folder));
                } else {
                    tasks.push(await this.createBuildTask(projectFile, projectInfo.type, folder));
                    tasks.push(await this.createBuildTask(projectFile, projectInfo.type, folder, true));
                    tasks.push(await this.createCleanTask(projectFile, projectInfo.type, folder));
                    tasks.push(await this.createRebuildTask(projectFile, projectInfo.type, folder));
                    tasks.push(await this.createRunTask(projectFile, projectInfo.type, folder));
                }
            }
        }
        
        return tasks;
    }
    
    /**
     * Resolve a task that has incomplete definition
     */
    async resolveTask(task: vscode.Task, token: vscode.CancellationToken): Promise<vscode.Task | undefined> {
        const definition = task.definition;
        
        if (definition.type !== 'qt') {
            return undefined;
        }
        
        // Task is already resolved if it has execution
        if (task.execution) {
            return task;
        }
        
        // Try to resolve the task
        const projectFile = definition.file;
        if (!projectFile || !fs.existsSync(projectFile)) {
            return undefined;
        }
        
        const projectInfo = await this.qtProjectDetector.getProjectInfo(projectFile);
        if (!projectInfo) {
            return undefined;
        }
        
        const workspaceFolder = vscode.workspace.getWorkspaceFolder(vscode.Uri.file(projectFile));
        if (!workspaceFolder) {
            return undefined;
        }
        
        switch (definition.task) {
            case 'build':
                return await this.createBuildTask(projectFile, projectInfo.type, workspaceFolder, definition.quickBuild === true);
            case 'clean':
                return await this.createCleanTask(projectFile, projectInfo.type, workspaceFolder);
            case 'rebuild':
                return await this.createRebuildTask(projectFile, projectInfo.type, workspaceFolder);
            case 'run':
                return await this.createRunTask(projectFile, projectInfo.type, workspaceFolder);
            default:
                return undefined;
        }
    }
    
    /**
     * Create a build task for a project
     */
    private getParallelFlag(makeCmd: string, jobs: number): string {
        const cmd = makeCmd.toLowerCase();
        if (cmd.includes('nmake')) {
            return ''; // nmake does not support parallel builds
        }
        if (cmd.includes('jom')) {
            return `/J ${jobs}`;
        }
        // mingw32-make, make, gmake
        return `-j${jobs}`;
    }

    private getBuildDir(projectFile: string, buildType: string): string {
        if (this.qtBuildKitManager) {
            return this.qtBuildKitManager.getBuildDirForProject(projectFile, buildType);
        }
        return this.qtConfigManager.getBuildDirectory();
    }

    private getKitEnvVars(projectFile: string): Record<string, string> {
        if (this.qtBuildKitManager) {
            return this.qtBuildKitManager.getKitEnvVars(projectFile);
        }
        return {};
    }

    private getKitExtraArgs(projectFile: string, projectType: 'qmake' | 'cmake' | 'python' | 'raw'): string {
        if (!this.qtBuildKitManager) { return ''; }
        if (projectType === 'qmake') {
            return this.qtBuildKitManager.getKitQMakeArgs(projectFile);
        }
        if (projectType === 'cmake') {
            return this.qtBuildKitManager.getKitCMakeArgs(projectFile);
        }
        return '';
    }

    private getKitToolchainFile(projectFile: string): string | undefined {
        if (this.qtBuildKitManager) {
            return this.qtBuildKitManager.getKitToolchainFile(projectFile);
        }
        return undefined;
    }

    private getCrossCompilePrefix(projectFile: string): string | undefined {
        if (this.qtBuildKitManager) {
            return this.qtBuildKitManager.getCrossCompilePrefix(projectFile);
        }
        return undefined;
    }

    private getSysroot(projectFile: string): string | undefined {
        if (this.qtBuildKitManager) {
            return this.qtBuildKitManager.getSysroot(projectFile);
        }
        return undefined;
    }

    private async createBuildTask(
        projectFile: string,
        projectType: 'qmake' | 'cmake' | 'python' | 'raw',
        workspaceFolder: vscode.WorkspaceFolder,
        quickBuild: boolean = false
    ): Promise<vscode.Task> {
        const qtInstallation = await this.qtConfigManager.getQtInstallation();
        const buildType = this.qtConfigManager.getProjectBuildType(projectFile);
        const buildDir = this.getBuildDir(projectFile, buildType);
        const kitEnv = this.getKitEnvVars(projectFile);
        const makeCmd = this.qtConfigManager.getMakeCommand(qtInstallation);
        const jobs = this.qtConfigManager.getParallelJobs();
        const parallelFlag = this.getParallelFlag(makeCmd, jobs);
        
        const projectName = path.basename(projectFile, path.extname(projectFile));
        
        const config = vscode.workspace.getConfiguration('qt');
        const preBuildCommand = config.get<string>('preBuildCommand') || '';
        const postBuildCommand = config.get<string>('postBuildCommand') || '';
        const useCcache = config.get<boolean>('useCcache') ?? false;
        const ccachePath = config.get<string>('ccachePath') || 'ccache';
        
        let execution: vscode.ShellExecution | vscode.CustomExecution;
        
        const kitExtraArgs = this.getKitExtraArgs(projectFile, projectType);

        if (projectType === 'qmake') {
            // QMake build: qmake -> make
            const qmakePath = qtInstallation?.qmakePath || 'qmake';
            const crossPrefix = this.getCrossCompilePrefix(projectFile);
            const sysroot = this.getSysroot(projectFile);
            const crossCompileArg = crossPrefix ? `-device-option CROSS_COMPILE=${crossPrefix}` : '';
            const sysrootArg = sysroot ? `-sysroot ${quotePath(sysroot)}` : '';
            const additionalArgs = [config.get<string>('additionalQMakeArguments') || '', kitExtraArgs, crossCompileArg, sysrootArg].filter(Boolean).join(' ');
            const buildTypeArg = buildType === 'release' ? 'CONFIG+=release' : 'CONFIG+=debug';
            const makeArgs = parallelFlag ? `${makeCmd} ${parallelFlag} V=1` : `${makeCmd} V=1`;
            
            const commands: string[] = [];
            if (preBuildCommand) {
                commands.push(preBuildCommand);
            }
            if (useCcache) {
                commands.push(isWindows() ? `set QMAKE_CXX=${ccachePath} g++` : `export QMAKE_CXX="${ccachePath} g++"`);
            }
            if (quickBuild && fs.existsSync(buildDir)) {
                // Quick build: skip qmake, just run make
                commands.push(
                    cdCmd(buildDir),
                    simpleExecCmd(makeArgs)
                );
            } else {
                commands.push(
                    mkdirCmd(buildDir),
                    cdCmd(buildDir),
                    execCmd(qmakePath, `${quotePath(projectFile)} ${buildTypeArg} ${additionalArgs}`),
                    simpleExecCmd(makeArgs)
                );
            }
            if (postBuildCommand) {
                commands.push(postBuildCommand);
            }
            
            const logPath = path.join(buildDir, '.qt-build-output.log');
            const buildCommand = joinCmds(...commands);
            execution = new vscode.CustomExecution(async () => {
                return new QtBuildPseudoterminal(buildCommand, workspaceFolder.uri.fsPath, kitEnv, logPath, this.outputChannel);
            });
        } else {
            // CMake build
            const toolchainFile = this.getKitToolchainFile(projectFile);
            const toolchainArg = toolchainFile ? `-DCMAKE_TOOLCHAIN_FILE=${quotePath(toolchainFile)}` : '';
            const crossPrefix = this.getCrossCompilePrefix(projectFile);
            const sysroot = this.getSysroot(projectFile);
            const crossCompileArg = crossPrefix && !toolchainFile
                ? `-DCMAKE_C_COMPILER=${quotePath(crossPrefix + 'gcc')} -DCMAKE_CXX_COMPILER=${quotePath(crossPrefix + 'g++')}`
                : '';
            const sysrootArg = sysroot ? `-DCMAKE_SYSROOT=${quotePath(sysroot)}` : '';
            const additionalArgs = [config.get<string>('additionalCMakeArguments') || '', kitExtraArgs, toolchainArg, crossCompileArg, sysrootArg].filter(Boolean).join(' ');
            const cmakeBuildArgs = parallelFlag ? `--parallel ${jobs}` : '';
            const presetArg = this.qtCMakePresets.getPresetArgs(projectFile);
            const verboseEnv = { ...kitEnv, VERBOSE: '1' };
            
            const commands: string[] = [];
            if (preBuildCommand) {
                commands.push(preBuildCommand);
            }
            const ccacheArg = useCcache ? `-DCMAKE_CXX_COMPILER_LAUNCHER=${ccachePath}` : '';
            if (presetArg) {
                // Use CMake preset
                if (quickBuild && fs.existsSync(buildDir)) {
                    commands.push(
                        `cmake --build ${quotePath(buildDir)} --preset ${this.qtCMakePresets.getPresetForProject(projectFile)?.build || this.qtCMakePresets.getPresetForProject(projectFile)?.configure || ''}`
                    );
                } else {
                    commands.push(
                        `cmake --preset ${this.qtCMakePresets.getPresetForProject(projectFile)?.configure || ''}`,
                        `cmake --build ${quotePath(buildDir)} ${cmakeBuildArgs}`
                    );
                }
            } else if (quickBuild && fs.existsSync(buildDir)) {
                // Quick build: skip cmake configure
                commands.push(
                    `cmake --build ${quotePath(buildDir)} ${cmakeBuildArgs}`
                );
            } else {
                commands.push(
                    mkdirCmd(buildDir),
                    `cmake -B ${quotePath(buildDir)} -S ${quotePath(path.dirname(projectFile))} -DCMAKE_BUILD_TYPE=${buildType} ${additionalArgs} ${ccacheArg}`,
                    `cmake --build ${quotePath(buildDir)} ${cmakeBuildArgs}`
                );
            }
            if (postBuildCommand) {
                commands.push(postBuildCommand);
            }
            
            const logPath = path.join(buildDir, '.qt-build-output.log');
            const buildCommand = joinCmds(...commands);
            execution = new vscode.CustomExecution(async () => {
                return new QtBuildPseudoterminal(buildCommand, workspaceFolder.uri.fsPath, verboseEnv, logPath, this.outputChannel);
            });
        }
        
        const task = new vscode.Task(
            {
                type: 'qt',
                task: 'build',
                file: projectFile,
                buildDir: buildDir
            },
            workspaceFolder,
            `Build ${projectName}`,
            'qt',
            execution,
            ['$msCompile', '$gcc', 'qt-qmake']
        );
        
        task.group = vscode.TaskGroup.Build;
        task.presentationOptions = {
            reveal: vscode.TaskRevealKind.Always,
            panel: vscode.TaskPanelKind.Dedicated,
            clear: true
        };
        
        return task;
    }
    
    /**
     * Create a clean task for a project
     */
    private async createCleanTask(
        projectFile: string,
        projectType: 'qmake' | 'cmake' | 'python' | 'raw',
        workspaceFolder: vscode.WorkspaceFolder
    ): Promise<vscode.Task> {
        const buildType = this.qtConfigManager.getProjectBuildType(projectFile);
        const buildDir = this.getBuildDir(projectFile, buildType);
        const makeCmd = this.qtConfigManager.getMakeCommand();
        const projectName = path.basename(projectFile, path.extname(projectFile));
        
        let execution: vscode.ShellExecution | vscode.CustomExecution;
        
        if (projectType === 'qmake') {
            // QMake clean
            const cleanCmd = joinCmds(
                cdCmd(buildDir),
                simpleExecCmd(`${makeCmd} clean`)
            );
            execution = new vscode.ShellExecution(
                ifDirExistsCmd(buildDir, cleanCmd),
                { cwd: workspaceFolder.uri.fsPath }
            );
        } else {
            // CMake clean
            execution = new vscode.ShellExecution(
                ifDirExistsCmd(buildDir, `cmake --build ${quotePath(buildDir)} --target clean`),
                { cwd: workspaceFolder.uri.fsPath }
            );
        }
        
        const task = new vscode.Task(
            {
                type: 'qt',
                task: 'clean',
                file: projectFile
            },
            workspaceFolder,
            `Clean ${projectName}`,
            'qt',
            execution
        );
        
        task.presentationOptions = {
            reveal: vscode.TaskRevealKind.Always,
            panel: vscode.TaskPanelKind.Dedicated,
            clear: true
        };
        
        return task;
    }
    
    /**
     * Create a rebuild task for a project
     */
    private async createRebuildTask(
        projectFile: string,
        projectType: 'qmake' | 'cmake' | 'python' | 'raw',
        workspaceFolder: vscode.WorkspaceFolder
    ): Promise<vscode.Task> {
        const qtInstallation = await this.qtConfigManager.getQtInstallation();
        const buildType = this.qtConfigManager.getProjectBuildType(projectFile);
        const buildDir = this.getBuildDir(projectFile, buildType);
        const makeCmd = this.qtConfigManager.getMakeCommand(qtInstallation);
        const jobs = this.qtConfigManager.getParallelJobs();
        const parallelFlag = this.getParallelFlag(makeCmd, jobs);
        const projectName = path.basename(projectFile, path.extname(projectFile));
        
        const config = vscode.workspace.getConfiguration('qt');
        const preBuildCommand = config.get<string>('preBuildCommand') || '';
        const postBuildCommand = config.get<string>('postBuildCommand') || '';
        
        let execution: vscode.ShellExecution | vscode.CustomExecution;
        
        if (projectType === 'qmake') {
            // QMake rebuild: clean -> qmake -> make
            const qmakePath = qtInstallation?.qmakePath || 'qmake';
            const crossPrefix = this.getCrossCompilePrefix(projectFile);
            const sysroot = this.getSysroot(projectFile);
            const crossCompileArg = crossPrefix ? `-device-option CROSS_COMPILE=${crossPrefix}` : '';
            const sysrootArg = sysroot ? `-sysroot ${quotePath(sysroot)}` : '';
            const additionalArgs = [config.get<string>('additionalQMakeArguments') || '', crossCompileArg, sysrootArg].filter(Boolean).join(' ');
            const buildTypeArg = buildType === 'release' ? 'CONFIG+=release' : 'CONFIG+=debug';
            const makeArgs = parallelFlag ? `${makeCmd} ${parallelFlag} V=1` : `${makeCmd} V=1`;
            const kitEnv = this.getKitEnvVars(projectFile);
            
            const commands: string[] = [];
            if (preBuildCommand) {
                commands.push(preBuildCommand);
            }
            commands.push(
                mkdirCmd(buildDir),
                cdCmd(buildDir),
                simpleExecCmd(`${makeCmd} clean ${nullRedirect()}`),
                execCmd(qmakePath, `${quotePath(projectFile)} ${buildTypeArg} ${additionalArgs}`),
                simpleExecCmd(makeArgs)
            );
            if (postBuildCommand) {
                commands.push(postBuildCommand);
            }
            
            const logPath = path.join(buildDir, '.qt-build-output.log');
            const buildCommand = joinCmds(...commands);
            execution = new vscode.CustomExecution(async () => {
                return new QtBuildPseudoterminal(buildCommand, workspaceFolder.uri.fsPath, kitEnv, logPath, this.outputChannel);
            });
        } else {
            // CMake rebuild
            const toolchainFile = this.getKitToolchainFile(projectFile);
            const toolchainArg = toolchainFile ? `-DCMAKE_TOOLCHAIN_FILE=${quotePath(toolchainFile)}` : '';
            const crossPrefix = this.getCrossCompilePrefix(projectFile);
            const sysroot = this.getSysroot(projectFile);
            const crossCompileArg = crossPrefix && !toolchainFile
                ? `-DCMAKE_C_COMPILER=${quotePath(crossPrefix + 'gcc')} -DCMAKE_CXX_COMPILER=${quotePath(crossPrefix + 'g++')}`
                : '';
            const sysrootArg = sysroot ? `-DCMAKE_SYSROOT=${quotePath(sysroot)}` : '';
            const additionalArgs = [config.get<string>('additionalCMakeArguments') || '', toolchainArg, crossCompileArg, sysrootArg].filter(Boolean).join(' ');
            const cmakeBuildArgs = parallelFlag ? `--parallel ${jobs}` : '';
            const preset = this.qtCMakePresets.getPresetForProject(projectFile);
            const kitEnv = this.getKitEnvVars(projectFile);
            const verboseEnv = { ...kitEnv, VERBOSE: '1' };
            
            const commands: string[] = [];
            if (preBuildCommand) {
                commands.push(preBuildCommand);
            }
            if (preset) {
                commands.push(
                    rmDirCmd(buildDir),
                    `cmake --preset ${preset.configure}`,
                    `cmake --build ${quotePath(buildDir)} ${cmakeBuildArgs}`
                );
            } else {
                commands.push(
                    rmDirCmd(buildDir),
                    `cmake -B ${quotePath(buildDir)} -S ${quotePath(path.dirname(projectFile))} -DCMAKE_BUILD_TYPE=${buildType} ${additionalArgs}`,
                    `cmake --build ${quotePath(buildDir)} ${cmakeBuildArgs}`
                );
            }
            if (postBuildCommand) {
                commands.push(postBuildCommand);
            }
            
            const logPath = path.join(buildDir, '.qt-build-output.log');
            const buildCommand = joinCmds(...commands);
            execution = new vscode.CustomExecution(async () => {
                return new QtBuildPseudoterminal(buildCommand, workspaceFolder.uri.fsPath, verboseEnv, logPath, this.outputChannel);
            });
        }
        
        const task = new vscode.Task(
            {
                type: 'qt',
                task: 'rebuild',
                file: projectFile,
                buildDir: buildDir
            },
            workspaceFolder,
            `Rebuild ${projectName}`,
            'qt',
            execution,
            ['$msCompile', '$gcc', 'qt-qmake']
        );
        
        task.group = vscode.TaskGroup.Build;
        task.presentationOptions = {
            reveal: vscode.TaskRevealKind.Always,
            panel: vscode.TaskPanelKind.Dedicated,
            clear: true
        };
        
        return task;
    }
    
    /**
     * Create a run task for a project
     */
    private async createRunTask(
        projectFile: string,
        projectType: 'qmake' | 'cmake' | 'python' | 'raw',
        workspaceFolder: vscode.WorkspaceFolder
    ): Promise<vscode.Task> {
        if (projectType === 'raw') {
            return this.createRawRunTask(projectFile, workspaceFolder);
        }
        const buildType = this.qtConfigManager.getProjectBuildType(projectFile);
        const buildDir = this.getBuildDir(projectFile, buildType);
        const projectName = path.basename(projectFile, path.extname(projectFile));
        
        // Try to find the executable
        const exePath = await this.qtProjectDetector.findExecutable(projectFile, buildDir);
        
        let execution: vscode.ShellExecution | vscode.CustomExecution;
        
        if (projectType === 'python') {
            // Python project: run with python interpreter
            const pythonCmd = isWindows() ? 'python' : 'python3';
            execution = new vscode.ShellExecution(`${pythonCmd} "${projectFile}"`, {
                cwd: workspaceFolder.uri.fsPath
            });
        } else if (exePath && fs.existsSync(exePath)) {
            execution = new vscode.ShellExecution(execCmd(exePath), {
                cwd: path.dirname(exePath)
            });
        } else {
            // Executable not found, show error
            const errorCmd = isWindows()
                ? `Write-Host "Error: Executable not found. Please build the project first." -ForegroundColor Red`
                : `echo "Error: Executable not found. Please build the project first."`;
            execution = new vscode.ShellExecution(errorCmd, {
                cwd: workspaceFolder.uri.fsPath
            });
        }
        
        const task = new vscode.Task(
            {
                type: 'qt',
                task: 'run',
                file: projectFile
            },
            workspaceFolder,
            `Run ${projectName}`,
            'qt',
            execution
        );
        
        task.presentationOptions = {
            reveal: vscode.TaskRevealKind.Always,
            panel: vscode.TaskPanelKind.Dedicated,
            clear: false,
            focus: true
        };
        
        task.isBackground = false;
        
        return task;
    }

    // ========================================================================
    // Raw Project Tasks
    // ========================================================================

    private async createRawBuildTask(
        projectDir: string,
        workspaceFolder: vscode.WorkspaceFolder
    ): Promise<vscode.Task> {
        const projectName = path.basename(projectDir);
        const makeCmd = process.platform === 'win32' ? 'mingw32-make' : 'make';

        const execution = new vscode.ShellExecution(
            `${makeCmd} -C "${projectDir}"`,
            { cwd: workspaceFolder.uri.fsPath }
        );

        const task = new vscode.Task(
            { type: 'qt', task: 'build', file: projectDir },
            workspaceFolder,
            `Build ${projectName}`,
            'qt',
            execution,
            ['$msCompile', '$gcc']
        );
        task.group = vscode.TaskGroup.Build;
        task.presentationOptions = { reveal: vscode.TaskRevealKind.Always, panel: vscode.TaskPanelKind.Dedicated, clear: true };
        return task;
    }

    private async createRawCleanTask(
        projectDir: string,
        workspaceFolder: vscode.WorkspaceFolder
    ): Promise<vscode.Task> {
        const projectName = path.basename(projectDir);
        const makeCmd = process.platform === 'win32' ? 'mingw32-make' : 'make';

        const execution = new vscode.ShellExecution(
            `${makeCmd} -C "${projectDir}" clean`,
            { cwd: workspaceFolder.uri.fsPath }
        );

        const task = new vscode.Task(
            { type: 'qt', task: 'clean', file: projectDir },
            workspaceFolder,
            `Clean ${projectName}`,
            'qt',
            execution
        );
        task.presentationOptions = { reveal: vscode.TaskRevealKind.Always, panel: vscode.TaskPanelKind.Dedicated, clear: true };
        return task;
    }

    private async createRawRunTask(
        projectDir: string,
        workspaceFolder: vscode.WorkspaceFolder
    ): Promise<vscode.Task> {
        const projectName = path.basename(projectDir);
        const exeName = process.platform === 'win32' ? `${projectName}.exe` : projectName;
        const exePath = path.join(projectDir, exeName);

        let command: string;
        if (fs.existsSync(exePath)) {
            command = `"${exePath}"`;
        } else {
            command = isWindows()
                ? `Write-Host "Error: Executable not found at ${exePath}. Please build first." -ForegroundColor Red`
                : `echo "Error: Executable not found at ${exePath}. Please build first."`;
        }

        const execution = new vscode.ShellExecution(command, { cwd: projectDir });

        const task = new vscode.Task(
            { type: 'qt', task: 'run', file: projectDir },
            workspaceFolder,
            `Run ${projectName}`,
            'qt',
            execution
        );
        task.presentationOptions = { reveal: vscode.TaskRevealKind.Always, panel: vscode.TaskPanelKind.Dedicated, clear: false, focus: true };
        task.isBackground = false;
        return task;
    }
}
