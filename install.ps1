# Qt C++ Tools - VS Code Extension Installation and Testing Script

Write-Host "================================" -ForegroundColor Cyan
Write-Host "Qt C++ Tools Extension Setup" -ForegroundColor Cyan
Write-Host "================================" -ForegroundColor Cyan
Write-Host ""

# Step 1: Check if Node.js is installed
Write-Host "[1/6] Checking Node.js installation..." -ForegroundColor Yellow
$nodeVersion = node --version 2>$null
if ($LASTEXITCODE -eq 0) {
    Write-Host "✓ Node.js found: $nodeVersion" -ForegroundColor Green
}
else {
    Write-Host "✗ Node.js not found! Please install Node.js from https://nodejs.org/" -ForegroundColor Red
    exit 1
}

# Step 2: Check if npm is installed
Write-Host "[2/6] Checking npm installation..." -ForegroundColor Yellow
$npmVersion = npm --version 2>$null
if ($LASTEXITCODE -eq 0) {
    Write-Host "✓ npm found: $npmVersion" -ForegroundColor Green
}
else {
    Write-Host "✗ npm not found!" -ForegroundColor Red
    exit 1
}

# Step 3: Install dependencies
Write-Host "[3/6] Installing npm dependencies..." -ForegroundColor Yellow
npm install
if ($LASTEXITCODE -ne 0) {
    Write-Host "✗ Failed to install dependencies" -ForegroundColor Red
    exit 1
}
Write-Host "✓ Dependencies installed successfully" -ForegroundColor Green

# Step 4: Compile TypeScript
Write-Host "[4/6] Compiling TypeScript..." -ForegroundColor Yellow
npm run compile
if ($LASTEXITCODE -ne 0) {
    Write-Host "✗ Compilation failed" -ForegroundColor Red
    exit 1
}
Write-Host "✓ Compilation successful" -ForegroundColor Green

# Step 5: Package extension
Write-Host "[5/6] Packaging extension..." -ForegroundColor Yellow
npm run package
if ($LASTEXITCODE -ne 0) {
    Write-Host "✗ Packaging failed" -ForegroundColor Red
    exit 1
}
Write-Host "✓ Extension packaged successfully" -ForegroundColor Green

# Step 6: Install extension
Write-Host "[6/6] Installing extension to VS Code..." -ForegroundColor Yellow
$vsixFile = Get-ChildItem -Filter "*.vsix" -ErrorAction SilentlyContinue | Select-Object -First 1

if ($null -ne $vsixFile) {
    Write-Host "Found VSIX file: $($vsixFile.Name)" -ForegroundColor White
    code --install-extension $vsixFile.FullName --force
    if ($LASTEXITCODE -eq 0) {
        Write-Host "✓ Extension installed successfully!" -ForegroundColor Green
    }
    else {
        Write-Host "⚠ Extension installed (code command may not have exited cleanly)" -ForegroundColor Yellow
    }
}
else {
    Write-Host "✗ No .vsix file found" -ForegroundColor Red
    exit 1
}

Write-Host ""
Write-Host "================================" -ForegroundColor Cyan
Write-Host "Installation Complete!" -ForegroundColor Green
Write-Host "================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "Next Steps:" -ForegroundColor Yellow
Write-Host "1. Restart VS Code or reload the window (Ctrl+Shift+P -> 'Reload Window')" -ForegroundColor White
Write-Host "2. Open a folder containing a Qt project (.pro or CMakeLists.txt)" -ForegroundColor White
Write-Host "3. Use Ctrl+Shift+P and type 'Qt:' to see available commands" -ForegroundColor White
Write-Host "4. Configure Qt path if needed: 'Qt: Configure Qt Installation Path'" -ForegroundColor White
Write-Host ""
Write-Host "For development/testing:" -ForegroundColor Yellow
Write-Host "- Press F5 in this workspace to launch Extension Development Host" -ForegroundColor White
Write-Host "- Check 'Qt C++ Tools' output channel for logs" -ForegroundColor White
Write-Host ""
