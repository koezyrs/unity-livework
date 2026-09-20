#if UNITY_EDITOR
using System;
using System.Collections;
using System.Collections.Generic;
using System.Linq;
using System.Reflection;
using UnityEngine;

namespace LiveWork
{
    // Advances streaming work on Editor ticks without advancing the game's PlayerLoop.
    public sealed class StreamingScheduler : IDisposable
    {
        sealed class Job {
            public readonly Stack<IEnumerator> stack = new Stack<IEnumerator>();
            public object wait;
            public double until;
        }
        readonly MonoBehaviour owner;
        readonly Dictionary<Coroutine, Job> jobs = new Dictionary<Coroutine, Job>();
        static readonly FieldInfo seconds = typeof(WaitForSeconds).GetField("m_Seconds", BindingFlags.Instance | BindingFlags.NonPublic);
        public StreamingScheduler(MonoBehaviour owner) { this.owner = owner; }
        static IEnumerator Placeholder() { while (true) yield return null; }
        public Coroutine Start(IEnumerator routine)
        {
            var handle = owner.StartCoroutine(Placeholder());
            var job = new Job(); job.stack.Push(routine); jobs.Add(handle, job);
            if (!Advance(job)) Stop(handle);
            return handle;
        }
        public void Stop(Coroutine handle)
        {
            if (handle == null || !jobs.TryGetValue(handle, out var job)) return;
            jobs.Remove(handle);
            foreach (var routine in job.stack) (routine as IDisposable)?.Dispose();
            if (owner != null) owner.StopCoroutine(handle);
        }
        public void Tick()
        {
            foreach (var pair in jobs.ToArray()) {
                if (!jobs.ContainsKey(pair.Key)) continue;
                try { if (!Advance(pair.Value)) Stop(pair.Key); }
                catch { Stop(pair.Key); throw; }
            }
        }
        static bool Advance(Job job)
        {
            if (job.until > UnityEditor.EditorApplication.timeSinceStartup) return true;
            if (job.wait is CustomYieldInstruction instruction && instruction.keepWaiting) return true;
            if (job.wait is AsyncOperation operation && !operation.isDone) return true;
            job.wait = null;
            for (int safety = 0; safety < 128 && job.stack.Count > 0; safety++) {
                var current = job.stack.Peek();
                if (!current.MoveNext()) { job.stack.Pop(); (current as IDisposable)?.Dispose(); continue; }
                var yielded = current.Current;
                if (yielded is CustomYieldInstruction custom) { if (custom.keepWaiting) { job.wait = custom; return true; } continue; }
                if (yielded is IEnumerator nested) { job.stack.Push(nested); continue; }
                if (yielded is WaitForSeconds delay) job.until = UnityEditor.EditorApplication.timeSinceStartup + (float)seconds.GetValue(delay);
                else if (yielded is AsyncOperation asyncOperation) job.wait = asyncOperation;
                // null / WaitForEndOfFrame resumes on the next capture tick.
                return true;
            }
            return job.stack.Count > 0;
        }
        public void Dispose() { foreach (var handle in jobs.Keys.ToArray()) Stop(handle); }
    }
}
#endif
