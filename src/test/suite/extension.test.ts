import * as assert from 'assert';
import * as vscode from 'vscode';

suite('Extension Test Suite', () => {
    suiteSetup(async () => {
        const extension = vscode.extensions.getExtension('akhilp19.qt-vsc-extension');
        assert.ok(extension, 'Extension should be present');
        if (!extension.isActive) {
            await extension.activate();
        }
        assert.strictEqual(extension.isActive, true, 'Extension should be active');
    });

    test('qt commands are registered', async () => {
        const commands = await vscode.commands.getCommands(true);
        assert.ok(commands.includes('qt.buildProject'), 'qt.buildProject command should be registered');
        assert.ok(commands.includes('qt.runProject'), 'qt.runProject command should be registered');
    });
});
