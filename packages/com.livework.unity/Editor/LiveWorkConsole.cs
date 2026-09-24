using System;
using System.Collections.Concurrent;
using System.Collections.Generic;
using System.Threading;
using UnityEditor.Compilation;
using UnityEngine;

namespace LiveWork.Editor
{
    [Serializable] public class LogEntry { public string level, message, stack; public long time; }
    [Serializable] public class LogBatch { public int v = 1; public string type = "logs"; public LogEntry[] entries; }

    /// <summary>Collects Editor and game logs and sends them to the browser in small batches.</summary>
    public static class LiveWorkConsole
    {
        const int MaxQueue = 500, MaxBatch = 100, MaxPerSecond = 200, MaxBatchChars = 20000;
        static readonly ConcurrentQueue<LogEntry> queue = new ConcurrentQueue<LogEntry>();
        static int queued, skipped, sentThisSecond;
        static double second, nextFlush;

        public static void Start()
        {
            Stop();
            Application.logMessageReceivedThreaded += Receive;
            CompilationPipeline.assemblyCompilationFinished += Compiled;
        }

        public static void Stop()
        {
            Application.logMessageReceivedThreaded -= Receive;
            CompilationPipeline.assemblyCompilationFinished -= Compiled;
        }

        public static void Clear() { while (queue.TryDequeue(out _)) { } queued = 0; skipped = 0; }

        // Called from any thread.
        static void Receive(string message, string stack, LogType type) =>
            Add(type == LogType.Log ? "info" : type == LogType.Warning ? "warning" : "error", message, stack);

        // Compiler messages reach the Unity Console without the log callback.
        static void Compiled(string assembly, CompilerMessage[] messages)
        {
            foreach (var m in messages)
                if (m.type == CompilerMessageType.Error || m.type == CompilerMessageType.Warning) Add(m.type == CompilerMessageType.Error ? "error" : "warning", m.message, "");
        }

        static void Add(string level, string message, string stack)
        {
            if (Interlocked.Increment(ref queued) > MaxQueue) { Interlocked.Decrement(ref queued); Interlocked.Increment(ref skipped); return; }
            queue.Enqueue(new LogEntry { level = level, message = Trim(message, 4000), stack = Trim(stack, 8000), time = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds() });
        }

        static string Trim(string s, int max) => string.IsNullOrEmpty(s) ? "" : s.Length <= max ? s : s.Substring(0, max);

        /// <summary>Returns the next batch as JSON when one is due, or null.</summary>
        public static string Flush(double now)
        {
            if (now < nextFlush) return null;
            nextFlush = now + .25;
            if (now - second >= 1) { second = now; sentThisSecond = 0; }
            var entries = new List<LogEntry>();
            int budget = Math.Min(MaxBatch, MaxPerSecond - sentThisSecond), chars = 0;
            var lost = Interlocked.Exchange(ref skipped, 0);
            if (lost > 0 && budget > 0) entries.Add(new LogEntry { level = "warning", message = $"{lost} log messages were skipped because Unity logged too fast.", stack = "", time = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds() });
            else if (lost > 0) Interlocked.Add(ref skipped, lost);
            // Keep each message well under the 128 KiB WebSocket limit.
            while (entries.Count < budget && chars < MaxBatchChars && queue.TryDequeue(out var entry)) {
                Interlocked.Decrement(ref queued);
                entries.Add(entry); chars += entry.message.Length + entry.stack.Length;
            }
            if (entries.Count == 0) return null;
            sentThisSecond += entries.Count;
            return JsonUtility.ToJson(new LogBatch { entries = entries.ToArray() });
        }
    }
}
