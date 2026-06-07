import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { QtConfigManager } from './qtConfigManager';
import { QtProjectDetector } from './qtProjectDetector';
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
    private outputChannel: vscode.OutputChannel;
    
    constructor(
        qtConfigManager: QtConfigManager,
        qtProjectDetector: QtProjectDetector,
        outputChannel: vscode.OutputChannel
    ) {
        this.qtConfigManager = qtConfigManager;
        this.qtProjectDetector = qtProjectDetector;
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
                tasks.push(await this.createBuildTask(projectFile, projectInfo.type, folder));
                tasks.push(await this.createBuildTask(projectFile, projectInfo.type, folder, true));
                tasks.push(await this.createCleanTask(projectFile, projectInfo.type, folder));
                tasks.push(await this.createRebuildTask(projectFile, projectInfo.type, folder));
                tasks.push(await this.createRunTask(projectFile, projectInfo.type, folder));
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

    private async createBuildTask(
        projectFile: string,
        projectType: 'qmake' | 'cmake',
        workspaceFolder: vscode.WorkspaceFolder,
        quickBuild: boolean = false
    ): Promise<vscode.Task> {
        const qtInstallation = await this.qtConfigManager.getQtInstallation();
        const buildDir = this.qtConfigManager.getBuildDirectory();
        const makeCmd = this.qtConfigManager.getMakeCommand(qtInstallation);
        const buildType = this.qtConfigManager.getProjectBuildType(projectFile);
        const jobs = this.qtConfigManager.getParallelJobs();
        const parallelFlag = this.getParallelFlag(makeCmd, jobs);
        
        const projectName = path.basename(projectFile, path.extname(projectFile));
        
        const config = vscode.workspace.getConfiguration('qt');
        const preBuildCommand = config.get<string>('preBuildCommand') || '';
        const postBuildCommand = config.get<string>('postBuildCommand') || '';
        
        let execution: vscode.ShellExecution;
        
        if (projectType === 'qmake') {
            // QMake build: qmake -> make
            const qmakePath = qtInstallation?.qmakePath || 'qmake';
            const additionalArgs = config.get<string>('additionalQMakeArguments') || '';
            const buildTypeArg = buildType === 'release' ? 'CONFIG+=release' : 'CONFIG+=debug';
            const makeArgs = parallelFlag ? `${makeCmd} ${parallelFlag}` : makeCmd;
            
            const commands: string[] = [];
            if (preBuildCommand) {
                commands.push(preBuildCommand);
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
            
            execution = new vscode.ShellExecution(joinCmds(...commands), {
                cwd: workspaceFolder.uri.fsPath
            });
        } else {
            // CMake build
            const additionalArgs = config.get<string>('additionalCMakeArguments') || '';
            const cmakeBuildArgs = parallelFlag ? `--parallel ${jobs}` : '';
            
            const commands: string[] = [];
            if (preBuildCommand) {
                commands.push(preBuildCommand);
            }
            if (quickBuild && fs.existsSync(buildDir)) {
                // Quick build: skip cmake configure
                commands.push(
                    `cmake --build ${quotePath(buildDir)} ${cmakeBuildArgs}`
                );
            } else {
                commands.push(
                    mkdirCmd(buildDir),
                    `cmake -B ${quotePath(buildDir)} -S ${quotePath(path.dirname(projectFile))} -DCMAKE_BUILD_TYPE=${buildType} ${additionalArgs}`,
                    `cmake --build ${quotePath(buildDir)} ${cmakeBuildArgs}`
                );
            }
            if (postBuildCommand) {
                commands.push(postBuildCommand);
            }
            
            execution = new vscode.ShellExecution(joinCmds(...commands), {
                cwd: workspaceFolder.uri.fsPath
            });
        }
        
        const task = new vscode.Task(
            {
                type: 'qt',
                task: 'build',
                file: projectFile
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
        projectType: 'qmake' | 'cmake',
        workspaceFolder: vscode.WorkspaceFolder
    ): Promise<vscode.Task> {
        const buildDir = this.qtConfigManager.getBuildDirectory();
        const makeCmd = this.qtConfigManager.getMakeCommand();
        const projectName = path.basename(projectFile, path.extname(projectFile));
        
        let execution: vscode.ShellExecution;
        
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
        projectType: 'qmake' | 'cmake',
        workspaceFolder: vscode.WorkspaceFolder
    ): Promise<vscode.Task> {
        const qtInstallation = await this.qtConfigManager.getQtInstallation();
        const buildDir = this.qtConfigManager.getBuildDirectory();
        const makeCmd = this.qtConfigManager.getMakeCommand(qtInstallation);
        const buildType = this.qtConfigManager.getProjectBuildType(projectFile);
        const jobs = this.qtConfigManager.getParallelJobs();
        const parallelFlag = this.getParallelFlag(makeCmd, jobs);
        const projectName = path.basename(projectFile, path.extname(projectFile));
        
        const config = vscode.workspace.getConfiguration('qt');
        const preBuildCommand = config.get<string>('preBuildCommand') || '';
        const postBuildCommand = config.get<string>('postBuildCommand') || '';
        
        let execution: vscode.ShellExecution;
        
        if (projectType === 'qmake') {
            // QMake rebuild: clean -> qmake -> make
            const qmakePath = qtInstallation?.qmakePath || 'qmake';
            const additionalArgs = config.get<string>('additionalQMakeArguments') || '';
            const buildTypeArg = buildType === 'release' ? 'CONFIG+=release' : 'CONFIG+=debug';
            const makeArgs = parallelFlag ? `${makeCmd} ${parallelFlag}` : makeCmd;
            
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
            
            execution = new vscode.ShellExecution(joinCmds(...commands), {
                cwd: workspaceFolder.uri.fsPath
            });
        } else {
            // CMake rebuild
            const additionalArgs = config.get<string>('additionalCMakeArguments') || '';
            const cmakeBuildArgs = parallelFlag ? `--parallel ${jobs}` : '';
            
            const commands: string[] = [];
            if (preBuildCommand) {
                commands.push(preBuildCommand);
            }
            commands.push(
                rmDirCmd(buildDir),
                `cmake -B ${quotePath(buildDir)} -S ${quotePath(path.dirname(projectFile))} -DCMAKE_BUILD_TYPE=${buildType} ${additionalArgs}`,
                `cmake --build ${quotePath(buildDir)} ${cmakeBuildArgs}`
            );
            if (postBuildCommand) {
                commands.push(postBuildCommand);
            }
            
            execution = new vscode.ShellExecution(joinCmds(...commands), {
                cwd: workspaceFolder.uri.fsPath
            });
        }
        
        const task = new vscode.Task(
            {
                type: 'qt',
                task: 'rebuild',
                file: projectFile
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
        projectType: 'qmake' | 'cmake',
        workspaceFolder: vscode.WorkspaceFolder
    ): Promise<vscode.Task> {
        const buildDir = this.qtConfigManager.getBuildDirectory();
        const projectName = path.basename(projectFile, path.extname(projectFile));
        
        // Try to find the executable
        const exePath = await this.qtProjectDetector.findExecutable(projectFile, buildDir);
        
        let execution: vscode.ShellExecution;
        
        if (exePath && fs.existsSync(exePath)) {
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
}
