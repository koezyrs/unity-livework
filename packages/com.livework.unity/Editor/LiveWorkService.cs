using System;
using System.Diagnostics;
using System.IO;
using System.Threading.Tasks;
using UnityEditor;
using UnityEngine;

namespace LiveWork.Editor
{
    // UPM's Git cache is immutable. Run the bundled Node service from the project's Library.
    public static class LiveWorkService
    {
        public static bool IsPreparing { get; private set; }
        public static string ResolveDirectory()
        {
            var package = UnityEditor.PackageManager.PackageInfo.FindForAssembly(typeof(LiveWorkHost).Assembly);
            var source = Path.Combine(package.resolvedPath, "Service~");
            if (package.source == UnityEditor.PackageManager.PackageSource.Local || package.source == UnityEditor.PackageManager.PackageSource.Embedded) {
                var repository = Path.GetFullPath(Path.Combine(package.resolvedPath, "../../service"));
                if (File.Exists(Path.Combine(repository, "server.mjs"))) return repository;
            }
            if (!Directory.Exists(source)) return source;
            var hash = File.ReadAllText(Path.Combine(source, "bundle.sha256")).Trim();
            if (hash.Length != 64 || !System.Text.RegularExpressions.Regex.IsMatch(hash, "^[a-f0-9]+$")) throw new InvalidDataException("The bundled LiveWork service is invalid. Reinstall the package.");
            var target = Path.GetFullPath(Path.Combine(Application.dataPath, "../Library/LiveWork/service-" + hash.Substring(0, 12)));
            if (!File.Exists(Path.Combine(target, "bundle.sha256"))) {
                Directory.CreateDirectory(target);
                foreach (var file in Directory.GetFiles(source, "*", SearchOption.AllDirectories)) {
                    var relative = file.Substring(source.Length).TrimStart(Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar);
                    if (relative == "bundle.sha256") continue;
                    var destination = Path.Combine(target, relative);
                    Directory.CreateDirectory(Path.GetDirectoryName(destination));
                    File.Copy(file, destination, true);
                }
                File.Copy(Path.Combine(source, "bundle.sha256"), Path.Combine(target, "bundle.sha256"), true);
            }
            return target;
        }

        public static async Task PrepareAsync()
        {
            if (IsPreparing) throw new InvalidOperationException("The LiveWork service is already being prepared.");
            IsPreparing = true;
            EditorApplication.LockReloadAssemblies();
            try {
                var directory = LiveWorkHost.ServiceDirectory;
                if (!File.Exists(Path.Combine(directory, "server.mjs"))) throw new FileNotFoundException("LiveWork service was not found. Reinstall the package.");
                await Run("node", "--version", directory, true);
                if (!File.Exists(Path.Combine(directory, "node_modules/ws/package.json")))
                    await Run("cmd.exe", "/d /s /c \"npm.cmd ci --omit=dev --ignore-scripts --no-audit --no-fund\"", directory);
                if (!File.Exists(Path.Combine(directory, "generated/signaling.cjs"))) throw new FileNotFoundException("Run scripts/setup.ps1 in the repository, or reinstall the Git package to restore its bundled service.");
            } finally { EditorApplication.UnlockReloadAssemblies(); IsPreparing = false; }
        }

        static async Task Run(string executable, string arguments, string directory, bool checkNode = false)
        {
            using (var process = new Process()) {
                process.StartInfo = new ProcessStartInfo(executable, arguments) { WorkingDirectory = directory, UseShellExecute = false, CreateNoWindow = true, WindowStyle = ProcessWindowStyle.Hidden, RedirectStandardOutput = true, RedirectStandardError = true };
                try { process.Start(); }
                catch (Exception ex) { throw new InvalidOperationException("Install Node.js 22 or newer (including npm), then restart Unity. " + ex.Message); }
                var output = process.StandardOutput.ReadToEndAsync();
                var errors = process.StandardError.ReadToEndAsync();
                var deadline = DateTime.UtcNow.AddMinutes(3);
                while (!process.HasExited) {
                    if (DateTime.UtcNow > deadline) {
                        // Only terminate the process tree created by this preparation attempt.
                        using (var cleanup = Process.Start(new ProcessStartInfo("taskkill.exe", "/PID " + process.Id + " /T /F") { UseShellExecute = false, CreateNoWindow = true, WindowStyle = ProcessWindowStyle.Hidden })) {
                            while (cleanup != null && !cleanup.HasExited) await Task.Delay(100);
                        }
                        throw new TimeoutException("Service preparation timed out. Check your npm network connection and retry.");
                    }
                    await Task.Delay(100);
                }
                var text = await output;
                var errorText = await errors;
                if (process.ExitCode != 0) throw new InvalidOperationException("Service preparation failed. Check Node.js/npm and your network connection. " + errorText);
                if (checkNode && (!int.TryParse(text.Trim().TrimStart('v').Split('.')[0], out int major) || major < 22)) throw new InvalidOperationException("LiveWork requires Node.js 22 or newer. Install it and restart Unity.");
            }
        }
    }
}
