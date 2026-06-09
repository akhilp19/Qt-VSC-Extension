import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';

interface CMakePreset {
    name: string;
    hidden?: boolean;
    description?: string;
    generator?: string;
    binaryDir?: string;
    cacheVariables?: Record<string, unknown>;
    inherits?: string | string[];
}

interface CMakeBuildPreset {
    name: string;
    hidden?: boolean;
    configurePreset: string;
    description?: string;
    jobs?: number;
}

interface CMakePresetsFile {
    version: number;
    configurePresets?: CMakePreset[];
    buildPresets?: CMakeBuildPreset[];
}

interface PresetChoice {
    configureName: string;
    buildName?: string;
}

export class QtCMakePresets {
    private outputChannel: vscode.OutputChannel;

    constructor(outputChannel: vscode.OutputChannel) {
        this.outputChannel = outputChannel;
    }

    /**
     * Find and parse CMakePresets.json and CMakeUserPresets.json in the project directory.
     */
    async readPresets(projectFile: string): Promise<{ configure: CMakePreset[]; build: CMakeBuildPreset[] }> {
        const projectDir = path.dirname(projectFile);
        const configure: CMakePreset[] = [];
        const build: CMakeBuildPreset[] = [];

        const files = [
            path.join(projectDir, 'CMakePresets.json'),
            path.join(projectDir, 'CMakeUserPresets.json')
        ];

        for (const file of files) {
            if (!fs.existsSync(file)) { continue; }
            try {
                const content = fs.readFileSync(file, 'utf-8');
                const parsed: CMakePresetsFile = JSON.parse(content);

                if (parsed.version < 2) {
                    this.outputChannel.appendLine(`[CMake Presets] Skipping ${path.basename(file)} (version ${parsed.version} < 2)`);
                    continue;
                }

                if (parsed.configurePresets) {
                    for (const preset of parsed.configurePresets) {
                        if (!preset.hidden) {
                            configure.push(preset);
                        }
                    }
                }
                if (parsed.buildPresets) {
                    for (const preset of parsed.buildPresets) {
                        if (!preset.hidden) {
                            build.push(preset);
                        }
                    }
                }
            } catch (error) {
                this.outputChannel.appendLine(`[CMake Presets] Error parsing ${file}: ${String(error)}`);
            }
        }

        return { configure, build };
    }

    /**
     * Interactive command to select a CMake preset for a project.
     */
    async selectPreset(projectFile: string): Promise<void> {
        const { configure, build } = await this.readPresets(projectFile);

        if (configure.length === 0) {
            void vscode.window.showInformationMessage('No CMake presets found in this project.');
            return;
        }

        // Step 1: select configure preset
        const configurePick = await vscode.window.showQuickPick(
            configure.map(p => ({
                label: p.name,
                description: p.description || '',
                detail: p.generator ? `Generator: ${p.generator}` : '',
                preset: p
            })),
            { placeHolder: 'Select CMake configure preset' }
        );

        if (!configurePick) { return; }

        // Step 2: select build preset (optional)
        const matchingBuildPresets = build.filter(b => b.configurePreset === configurePick.preset.name);
        let buildPresetName: string | undefined;

        if (matchingBuildPresets.length > 0) {
            const buildPick = await vscode.window.showQuickPick(
                [
                    { label: '$(close) None', description: 'Use default build settings', preset: undefined },
                    ...matchingBuildPresets.map(p => ({
                        label: p.name,
                        description: p.description || '',
                        preset: p
                    }))
                ],
                { placeHolder: 'Select CMake build preset (optional)' }
            );
            if (buildPick?.preset) {
                buildPresetName = buildPick.preset.name;
            }
        }

        // Store selection
        const config = vscode.workspace.getConfiguration('qt');
        const presets = config.get<Record<string, { configure: string; build?: string }>>('cmakePresets') || {};
        presets[projectFile] = { configure: configurePick.preset.name, build: buildPresetName };
        await config.update('cmakePresets', presets, vscode.ConfigurationTarget.Workspace);

        void vscode.window.showInformationMessage(
            `CMake preset set: ${configurePick.preset.name}${buildPresetName ? ` / ${buildPresetName}` : ''}`
        );
        this.outputChannel.appendLine(`[CMake Presets] Selected for ${path.basename(projectFile)}: ${configurePick.preset.name}`);
    }

    /**
     * Clear the selected preset for a project.
     */
    async clearPreset(projectFile: string): Promise<void> {
        const config = vscode.workspace.getConfiguration('qt');
        const presets = config.get<Record<string, { configure: string; build?: string }>>('cmakePresets') || {};
        delete presets[projectFile];
        await config.update('cmakePresets', presets, vscode.ConfigurationTarget.Workspace);
        void vscode.window.showInformationMessage('CMake preset cleared');
    }

    /**
     * Get the selected preset for a project, if any.
     */
    getPresetForProject(projectFile: string): { configure: string; build?: string } | undefined {
        const config = vscode.workspace.getConfiguration('qt');
        const presets = config.get<Record<string, { configure: string; build?: string }>>('cmakePresets') || {};
        return presets[projectFile];
    }

    /**
     * Build cmake command-line arguments for the selected preset.
     */
    getPresetArgs(projectFile: string): string {
        const preset = this.getPresetForProject(projectFile);
        if (!preset) {
            return '';
        }
        if (preset.build) {
            return `--preset ${preset.build}`;
        }
        return `--preset ${preset.configure}`;
    }
}
