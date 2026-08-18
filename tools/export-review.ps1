<#
.SYNOPSIS
    Exports Randomayzer repository snapshots and diff packages for AI Security Reviewers.

.DESCRIPTION
    Creates clean, deterministic ZIP archives of tracked repository code at a specific commit.
    Guarantees that node_modules, local .env files, untracked artifacts, and IDE caches are never included.
    Includes automated REVIEW_CONTEXT.md, diffs, and verification metrics.

.PARAMETER Diff
    Generate a diff review package between Base commit and HEAD instead of a full snapshot.

.PARAMETER Base
    Base commit for diff mode (defaults to HEAD^).

.PARAMETER OutputDir
    Output directory for the generated ZIP file (defaults to Desktop\Randomayzer Reviews\).

.PARAMETER RequireClean
    If specified, aborts the export if the git working tree has uncommitted changes.

.PARAMETER AllowSensitiveTrackedFiles
    Bypasses the safety abort when potentially sensitive file patterns are detected in tracked git files.

.PARAMETER CopyPrompt
    Copies the standardized security reviewer instructions to the Windows clipboard upon completion.

.EXAMPLE
    .\tools\export-review.ps1

.EXAMPLE
    .\tools\export-review.ps1 -Diff

.EXAMPLE
    .\tools\export-review.ps1 -Diff -Base bc2b658 -CopyPrompt

.EXAMPLE
    .\tools\export-review.ps1 -OutputDir "D:\Audits" -RequireClean
#>

[CmdletBinding()]
param(
    [switch]$Diff,
    [string]$Base,
    [string]$OutputDir,
    [switch]$RequireClean,
    [switch]$AllowSensitiveTrackedFiles,
    [switch]$CopyPrompt
)

$ErrorActionPreference = "Stop"

# 1. Resolve Git repository root and metadata
$gitRootRaw = git rev-parse --show-toplevel 2>$null
if (-not $gitRootRaw -or $LASTEXITCODE -ne 0) {
    Write-Error "Not inside a git repository or git is unavailable."
    exit 1
}
$gitRoot = [System.IO.Path]::GetFullPath($gitRootRaw.Trim())

$headSha = (git rev-parse HEAD 2>$null).Trim()
$shortSha = (git rev-parse --short HEAD 2>$null).Trim()
$branch = (git rev-parse --abbrev-ref HEAD 2>$null).Trim()

$remoteUrl = (git config --get remote.origin.url 2>$null)
if (-not $remoteUrl) {
    $remoteUrl = "https://github.com/ochenstarik-ui/randomayzer"
} else {
    $remoteUrl = $remoteUrl.Trim()
}

# 2. Output directory resolution (relative to current PowerShell location)
if (-not $OutputDir) {
    $desktopPath = [Environment]::GetFolderPath([Environment+SpecialFolder]::Desktop)
    $OutputDir = [System.IO.Path]::Combine($desktopPath, "Randomayzer Reviews")
} else {
    if (-not [System.IO.Path]::IsPathRooted($OutputDir)) {
        $OutputDir = [System.IO.Path]::Combine((Get-Location).Path, $OutputDir)
    }
    $OutputDir = [System.IO.Path]::GetFullPath($OutputDir)
}

if (-not (Test-Path -LiteralPath $OutputDir)) {
    New-Item -ItemType Directory -Path $OutputDir -Force | Out-Null
}

# 3. Dirty worktree check
$statusOutput = git status --porcelain
$isDirty = [bool]($statusOutput -and ($statusOutput.Trim().Length -gt 0))

if ($isDirty) {
    if ($RequireClean) {
        Write-Error "Working tree contains uncommitted changes. -RequireClean was specified. Aborting export."
        exit 1
    } else {
        Write-Warning "Working tree contains uncommitted changes. Snapshot represents committed HEAD only."
    }
}
$dirtyText = if ($isDirty) { "YES" } else { "NO" }

# 4. Secret safety check on tracked files
$trackedFiles = git ls-tree -r --name-only HEAD
$sensitiveMatches = @()
$sensitiveRegex = '(?i)(^|/|\\)(\.env(\.(?!example$).*)?|\.env$|.*\.pem$|.*\.key$|credentials\.json$|secrets\.json$|.*\.p12$|.*\.pfx$)'

foreach ($file in $trackedFiles) {
    if ($file -match $sensitiveRegex -and $file -notmatch '(?i)\.env\.example') {
        $sensitiveMatches += $file
    }
}

if ($sensitiveMatches.Count -gt 0) {
    Write-Warning "=================================================="
    Write-Warning "POTENTIALLY SENSITIVE FILES DETECTED IN TRACKED GIT:"
    foreach ($sf in $sensitiveMatches) {
        Write-Warning "  - $sf"
    }
    Write-Warning "=================================================="
    if (-not $AllowSensitiveTrackedFiles) {
        Write-Error "Export aborted to prevent secret leakage. Pass -AllowSensitiveTrackedFiles to override."
        exit 1
    }
}

# Ensure .NET compression assemblies are loaded
Add-Type -AssemblyName System.IO.Compression
Add-Type -AssemblyName System.IO.Compression.FileSystem

$timestamp = (Get-Date).ToString("yyyy-MM-dd HH:mm:ss zzz")
$utf8NoBom = New-Object System.Text.UTF8Encoding($false)

# 5. Export generation
if (-not $Diff) {
    # ── FULL SNAPSHOT MODE ──
    $modeName = "FULL"
    $zipFileName = "randomayzer-review-$shortSha.zip"
    $zipFilePath = [System.IO.Path]::Combine($OutputDir, $zipFileName)

    if (Test-Path -LiteralPath $zipFilePath) {
        Remove-Item -LiteralPath $zipFilePath -Force
    }

    # Build clean archive directly from git HEAD
    Push-Location $gitRoot
    try {
        git archive HEAD --format=zip --output="$zipFilePath"
        if ($LASTEXITCODE -ne 0) {
            Write-Error "git archive failed with exit code $LASTEXITCODE"
            exit 1
        }
    } finally {
        Pop-Location
    }

    # Generate metadata context
    $gitLogStat = (git log -1 --stat HEAD) -join "`n"

    $reviewContextLines = @(
        "# Randomayzer Review Snapshot",
        "",
        "- **Full commit SHA:** $headSha",
        "- **Short SHA:** $shortSha",
        "- **Branch:** $branch",
        "- **Generated at:** $timestamp",
        "- **Repository:** $remoteUrl",
        "- **Snapshot mode:** FULL",
        "- **Working tree dirty at export time:** $dirtyText",
        "",
        "## Source of Truth",
        "The files in this archive are the exact tracked repository snapshot for the commit shown above.",
        "",
        "## Reviewer Instructions",
        "Do not use GitHub HEAD as source of truth.",
        "Review the attached snapshot.",
        "",
        "## Recent Commit Log",
        '```',
        $gitLogStat,
        '```'
    )
    $reviewContext = $reviewContextLines -join "`n"

    # Inject REVIEW_CONTEXT.md into ZIP
    $archive = [System.IO.Compression.ZipFile]::Open($zipFilePath, [System.IO.Compression.ZipArchiveMode]::Update)
    try {
        $existingEntry = $archive.GetEntry("REVIEW_CONTEXT.md")
        if ($existingEntry) {
            $existingEntry.Delete()
        }
        $entry = $archive.CreateEntry("REVIEW_CONTEXT.md", [System.IO.Compression.CompressionLevel]::Optimal)
        $stream = $entry.Open()
        try {
            $bytes = $utf8NoBom.GetBytes($reviewContext)
            $stream.Write($bytes, 0, $bytes.Length)
        } finally {
            $stream.Dispose()
        }
    } finally {
        $archive.Dispose()
    }

} else {
    # ── DIFF MODE ──
    $modeName = "DIFF"
    $zipFileName = "randomayzer-diff-review-$shortSha.zip"
    $zipFilePath = [System.IO.Path]::Combine($OutputDir, $zipFileName)

    if (Test-Path -LiteralPath $zipFilePath) {
        Remove-Item -LiteralPath $zipFilePath -Force
    }

    if (-not $Base) {
        $Base = "HEAD^"
    }

    $baseShaRaw = git rev-parse --verify "$Base" 2>$null
    if (-not $baseShaRaw -or $LASTEXITCODE -ne 0) {
        Write-Error "Invalid base commit: '$Base'"
        exit 1
    }
    $baseSha = $baseShaRaw.Trim()
    $baseShortSha = (git rev-parse --short $baseSha 2>$null).Trim()

    # Generate diff and list of changed files
    $diffPatch = (git diff $baseSha HEAD) -join "`n"
    $changedFiles = git diff --name-only $baseSha HEAD
    $changedFilesList = @()
    if ($changedFiles) {
        $changedFilesList = @($changedFiles) | Where-Object { $_ -and $_.Trim().Length -gt 0 }
    }
    $changedFilesText = ($changedFilesList -join "`n")

    # Determine files to include in Diff package:
    # 1. Changed files present in HEAD (exclude deleted files)
    # 2. All tracked test files (tests/*)
    # 3. Security, config, and documentation context files
    $trackedHeadFiles = git ls-tree -r --name-only HEAD
    $filesToInclude = [System.Collections.Generic.HashSet[string]]::new([System.StringComparer]::OrdinalIgnoreCase)

    foreach ($cf in $changedFilesList) {
        if ($trackedHeadFiles -contains $cf) {
            $filesToInclude.Add($cf) | Out-Null
        }
    }

    # Add all tracked test files for test integrity review
    foreach ($tf in $trackedHeadFiles) {
        if ($tf -like "tests/*" -or $tf -like "test/*") {
            $filesToInclude.Add($tf) | Out-Null
        }
    }

    # Add schema, dependencies, env.example, and documentation
    $contextPatterns = @(
        "package.json",
        "package-lock.json",
        "prisma/schema.prisma",
        ".env.example",
        "README.md",
        "AGENTS.md",
        "GEMINI.md",
        "docs/*"
    )

    foreach ($pattern in $contextPatterns) {
        foreach ($hf in $trackedHeadFiles) {
            if ($hf -like $pattern) {
                # Security filter
                if ($hf -match $sensitiveRegex -and $hf -notmatch '(?i)\.env\.example') {
                    continue
                }
                $filesToInclude.Add($hf) | Out-Null
            }
        }
    }

    # Stage files in temporary directory
    $tempDir = [System.IO.Path]::Combine([System.IO.Path]::GetTempPath(), ("randomayzer_export_" + [System.Guid]::NewGuid().ToString("N")))
    New-Item -ItemType Directory -Path $tempDir -Force | Out-Null

    try {
        Push-Location $gitRoot
        try {
            foreach ($relPath in $filesToInclude) {
                $gitRelPath = $relPath -replace '\\', '/'
                $destPath = [System.IO.Path]::Combine($tempDir, ($relPath -replace '/', [System.IO.Path]::DirectorySeparatorChar))
                $destParent = [System.IO.Path]::GetDirectoryName($destPath)
                if (-not (Test-Path -LiteralPath $destParent)) {
                    New-Item -ItemType Directory -Path $destParent -Force | Out-Null
                }

                # Extract exact binary content from HEAD
                $processInfo = New-Object System.Diagnostics.ProcessStartInfo
                $processInfo.FileName = "git"
                $processInfo.Arguments = "show `"HEAD:$gitRelPath`""
                $processInfo.WorkingDirectory = $gitRoot
                $processInfo.UseShellExecute = $false
                $processInfo.RedirectStandardOutput = $true
                $processInfo.RedirectStandardError = $true
                $processInfo.CreateNoWindow = $true

                $process = [System.Diagnostics.Process]::Start($processInfo)
                $outputStream = [System.IO.File]::Create($destPath)
                try {
                    $process.StandardOutput.BaseStream.CopyTo($outputStream)
                } finally {
                    $outputStream.Dispose()
                }
                $process.WaitForExit()
            }
        } finally {
            Pop-Location
        }

        # Write diff artifacts
        [System.IO.File]::WriteAllText([System.IO.Path]::Combine($tempDir, "REVIEW_DIFF.patch"), $diffPatch, $utf8NoBom)
        [System.IO.File]::WriteAllText([System.IO.Path]::Combine($tempDir, "REVIEW_CHANGED_FILES.txt"), $changedFilesText, $utf8NoBom)

        # Generate REVIEW_CONTEXT.md
        $gitLogStat = (git log --stat "$baseSha..HEAD") -join "`n"

        $reviewContextLines = @(
            "# Randomayzer Review Snapshot (Diff Mode)",
            "",
            "- **Full commit SHA:** $headSha",
            "- **Short SHA:** $shortSha",
            "- **Branch:** $branch",
            "- **Generated at:** $timestamp",
            "- **Repository:** $remoteUrl",
            "- **Snapshot mode:** DIFF",
            "- **Base commit:** $baseSha ($baseShortSha)",
            "- **Target commit:** $headSha ($shortSha)",
            "- **Working tree dirty at export time:** $dirtyText",
            "",
            "## Source of Truth",
            "The files in this archive are the exact tracked repository snapshot for the commit shown above.",
            "This archive contains the diff against base commit, changed files, relevant test suites, schema definitions, and project documentation.",
            "",
            "## Reviewer Instructions",
            "Do not use GitHub HEAD as source of truth.",
            "Review the attached snapshot.",
            "- Check `REVIEW_DIFF.patch` for the complete patch.",
            "- Check `REVIEW_CHANGED_FILES.txt` for the list of modified files.",
            "- Inspect the included source and test files.",
            "",
            "## Recent Commit Log ($baseShortSha..$shortSha)",
            '```',
            $gitLogStat,
            '```'
        )
        $reviewContext = $reviewContextLines -join "`n"

        [System.IO.File]::WriteAllText([System.IO.Path]::Combine($tempDir, "REVIEW_CONTEXT.md"), $reviewContext, $utf8NoBom)

        # Compress staged directory
        [System.IO.Compression.ZipFile]::CreateFromDirectory($tempDir, $zipFilePath, [System.IO.Compression.CompressionLevel]::Optimal, $false)
    } finally {
        if (Test-Path -LiteralPath $tempDir) {
            Remove-Item -LiteralPath $tempDir -Recurse -Force -ErrorAction SilentlyContinue
        }
    }
}

# 6. Verify Archive & Display Summary
$zip = [System.IO.Compression.ZipFile]::OpenRead($zipFilePath)
$fileCount = $zip.Entries.Count
$zip.Dispose()

$fileInfo = Get-Item -LiteralPath $zipFilePath
$sizeBytes = $fileInfo.Length
$sizeFormatted = if ($sizeBytes -ge 1MB) {
    "{0:N2} MB ({1:N0} bytes)" -f ($sizeBytes / 1MB), $sizeBytes
} elseif ($sizeBytes -ge 1KB) {
    "{0:N2} KB ({1:N0} bytes)" -f ($sizeBytes / 1KB), $sizeBytes
} else {
    "{0} bytes" -f $sizeBytes
}

Write-Host ""
Write-Host "==================================================" -ForegroundColor Cyan
Write-Host " Randomayzer Review Package Exported Successfully " -ForegroundColor Cyan
Write-Host "==================================================" -ForegroundColor Cyan
Write-Host ("Created:  " + $zipFilePath) -ForegroundColor Green
Write-Host ("Commit:   " + $headSha + " (" + $shortSha + ")")
Write-Host ("Mode:     " + $modeName)
Write-Host ("Files:    " + $fileCount)
Write-Host ("Size:     " + $sizeFormatted)
Write-Host "==================================================" -ForegroundColor Cyan

# 7. Optional Clipboard Prompt
if ($CopyPrompt) {
    $clipboardPromptLines = @(
        "В приложенном архиве snapshot Randomayzer на commit $headSha.",
        "Используй архив как source of truth.",
        "Не используй GitHub HEAD вместо него.",
        "Выполни ранее выданное security review задание."
    )
    $clipboardPrompt = $clipboardPromptLines -join "`n"

    try {
        if (Get-Command Set-Clipboard -ErrorAction SilentlyContinue) {
            Set-Clipboard -Value $clipboardPrompt
            Write-Host "Reviewer prompt copied to clipboard." -ForegroundColor Yellow
        } else {
            Write-Warning "Set-Clipboard is not available in this environment."
        }
    } catch {
        Write-Warning "Could not copy prompt to clipboard: $_"
    }
}
