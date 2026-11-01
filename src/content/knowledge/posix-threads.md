---
title: "POSIX Threads: Doing Several Things at Once in Linux"
brief: "How threads share memory, how mutexes and condition variables keep them in step, and how to build a clean multithreaded service."
order: 47
phase: 8
tags: ["pthreads", "Threads", "Mutex", "Condition Variable", "Deadlock"]
---

A gateway has to read a sensor, talk to a server and drive a display, all at once. If the network call blocks for ten seconds, the display must not freeze. Threads let one program do several things at the same time, and they bring some of the hardest bugs in software.

## The Fundamental Problem

A single flow of execution waits on one thing at a time. Separate processes solve this, but sharing data between them is awkward. Threads share one memory space, which makes communication easy and also makes it easy for two of them to corrupt the same data. Some bugs appear only once a month, under load.

## The Big Picture

![Producer and consumer threads share a queue protected by a mutex](/diagrams/posix_threads.svg)

### In Plain Terms

Picture a kitchen with several cooks. They share one fridge and one chopping board, which is much faster than each having their own kitchen. But if two cooks grab the same board, things go wrong.

A mutex is the single key to the chopping board: only the cook holding it may use the board. A condition variable is a bell: a cook with nothing to do sleeps, and rings out when food arrives. A deadlock is two cooks each holding a tool the other needs, both waiting forever.

## Key Concepts and Terminology

| Term | What it means |
| --- | --- |
| **Thread** | One flow of execution in a process, sharing its memory. |
| **Race condition** | The result depends on timing between threads. |
| **Mutex** | A lock that lets only one thread in at a time. |
| **Critical section** | Code that must not be run by two threads at once. |
| **Condition variable** | Lets a thread sleep until something changes. |
| **Deadlock** | Threads waiting for each other forever. |
| **Atomic** | An operation that cannot be seen half-finished. |

## How It Works

### Step 1: Create threads

`pthread_create` starts a function in a new thread, with its own stack and shared heap and globals.

### Step 2: Protect shared data

Each access to shared data happens with a mutex locked.

### Step 3: Wait without spinning

A thread with no work calls `pthread_cond_wait`, which unlocks the mutex and sleeps.

### Step 4: Signal

A producer adds work and calls `pthread_cond_signal` to wake it.

### Step 5: Stop cleanly

A shutdown flag and a final signal let each thread exit. `pthread_join` waits for them.

## A Closer Look: Why `count++` Is Not Safe

Here is the classic race, and it is worth seeing exactly why it happens.

Two threads each run `count++`. It looks like one action, but the CPU does three: load the value into a register, add one, store it back.

Suppose `count` is 5. Thread A loads 5. Before it stores, thread B runs, also loads 5, adds one and stores 6. Then thread A continues, adds one to its copy and stores 6. Two increments happened, and the count only went up by one.

Nothing crashed, and no error appeared. A number is simply wrong. It might only happen when timing lines up, perhaps once in a million runs. That is why races pass every test, then show up in the field.

A mutex fixes this by making the three steps a single unit from the other thread's point of view. Thread B must wait until A has finished. The cost is a little time, and the benefit is that the result is always right. For a simple counter, `atomic_fetch_add` does the same job without a lock.

## A Worked Example: A Sensor Queue

One thread reads a sensor, and another sends data to a server:

```c
static pthread_mutex_t lock = PTHREAD_MUTEX_INITIALIZER;
static pthread_cond_t  ready = PTHREAD_COND_INITIALIZER;

void put(int v)
{
    pthread_mutex_lock(&lock);
    queue_push(v);
    pthread_cond_signal(&ready);
    pthread_mutex_unlock(&lock);
}

int get(void)
{
    pthread_mutex_lock(&lock);
    while (queue_empty())
        pthread_cond_wait(&ready, &lock);
    int v = queue_pop();
    pthread_mutex_unlock(&lock);
    return v;
}
```

Why `while` and not `if`? A thread can wake when the queue is empty again, either because another consumer got there first or from a spurious wakeup. So it must check again on waking.

Why is the slow network send outside `get`? Holding the lock during a network call would block the sensor thread for seconds. Keep locked sections short, and do slow work after unlocking.

## Common Questions

**Thread or process?** Threads share memory and are good for closely related work. Processes give stronger isolation, so a crash stays contained.

**How many threads should I use?** As few as the design allows. Use one per independent blocking activity.

**What is the difference between a mutex and a semaphore?** A mutex is a lock, owned by whoever takes it. A semaphore is a counter used for signalling.

**Why does `pthread_cond_wait` take a mutex?** It releases the lock while sleeping, and re-takes it on waking, so no wake-up is missed.

## Under the Hood

Linux threads are kernel tasks sharing an address space, and a mutex normally costs very little when uncontended. It uses a futex: a fast atomic operation in user space, calling the kernel only if a thread actually needs to wait.

CPUs and compilers reorder memory operations, so without a lock or atomic, one thread may see another's writes in an unexpected order. `volatile` does not solve this. Use mutexes or C11 atomics.

Each thread's stack defaults to several megabytes of virtual memory, so on small systems set it with `pthread_attr_setstacksize`. Real-time work can use `SCHED_FIFO` priorities, with priority-inheritance mutexes to avoid priority inversion.

## Real-World Applications

**Middleware services.** Separate threads for network, sensors and logging.

**GUI applications.** LVGL stays on one thread, and background threads post updates.

**Data acquisition.** A high-priority thread reads data, and another writes to disk.

**Thread pools.** A fixed group of workers handles incoming jobs.

## Common Mistakes

### Mistake 1: Locks in different orders

**What goes wrong:** Thread 1 takes A then B while thread 2 takes B then A, causing a deadlock.

**How to avoid it:** Define one global lock order.

### Mistake 2: Using volatile for sharing

**What goes wrong:** It works in tests, then fails on a multi-core system.

**How to avoid it:** Use mutexes or atomics.

### Mistake 3: Blocking while holding a lock

**What goes wrong:** One slow call freezes every other thread.

**How to avoid it:** Copy data out, unlock, then do the work.

## Debugging and Troubleshooting

**Symptom:** The program hangs and CPU is idle

**Possible Cause:** A deadlock.

**Investigation Method:** Attach GDB and run `thread apply all bt`, then look for threads stuck in lock calls.

**Resolution:** Fix the lock order.

**Symptom:** Rare corrupted values or crashes

**Possible Cause:** A data race.

**Investigation Method:** Build with `-fsanitize=thread`, or use Helgrind.

**Resolution:** Protect the data, or give it one owner.

## Design Considerations and Best Practices

**Share less.** Passing messages through queues avoids most locking.

**Name your threads.** `pthread_setname_np` makes debugging much easier.

**Use fewer threads.** Each adds memory use and more interactions.

**Handle errors from pthread calls.** They return error codes, and do not set `errno`.

## Expert Notes

**Design ownership, not locks.** The best thread-safe data is data that only one thread touches. Passing messages avoids many locks completely.

**Never call unknown code with a lock held.** A callback might take another lock, and you have created a hidden deadlock.

**Thread cancellation is rarely worth it.** `pthread_cancel` can leave locks held. A shutdown flag is safer and easier to reason about.

## Summary

Threads let a program do several things at once, and they share memory, like cooks in one kitchen. Use a mutex around shared data, condition variables to wait, and keep locked sections short. Most bugs come from races and lock ordering, so share as little as you can, and use sanitizers to find what remains.

## Related Topics

**Prerequisites**

- Concurrency and Synchronization
- Kernel vs User Space

**Next Topics**

- Linux IPC
- Debugging on Linux
