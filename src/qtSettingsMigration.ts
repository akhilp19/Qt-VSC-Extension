import * as vscode from 'vscode';

const CURRENT_EXTENSION_VERSION = '2.0.0';

export class QtSettingsMigration {
    private context: vscode.ExtensionContext;

    constructor(context: vscode.ExtensionContext) {
        this.context = context;
    }

    async run(): Promise<void> {
        const lastVersion = this.context.globalState.get<string>('qt.extensionVersion');
        if (lastVersion === CURRENT_EXTENSION_VERSION) {
            return; // Already up to date
        }

        // Perform migrations based on last known version
        if (!lastVersion || this.isOlderThan(lastVersion, '2.0.0')) {
            await this.migrateToV2_0_0();
        }

        // Update stored version
        await this.context.globalState.update('qt.extensionVersion', CURRENT_EXTENSION_VERSION);
    }

    private isOlderThan(current: string, target: string): boolean {
        const parse = (v: string) => v.split('.').map(n => parseInt(n, 10));
        const c = parse(current);
        const t = parse(target);
        for (let i = 0; i < Math.max(c.length, t.length); i++) {
            const cv = c[i] || 0;
            const tv = t[i] || 0;
            if (cv < tv) { return true; }
            if (cv > tv) { return false; }
        }
        return false;
    }

    private async migrateToV2_0_0(): Promise<void> {
        // v2.0.0: ensure buildKits setting exists as an array
        const config = vscode.workspace.getConfiguration('qt');
        const buildKits = config.get<unknown>('buildKits');
        if (buildKits === undefined) {
            await config.update('buildKits', [], vscode.ConfigurationTarget.Workspace);
        }
        // No breaking changes requiring user notification in v2.0.0
    }
}
