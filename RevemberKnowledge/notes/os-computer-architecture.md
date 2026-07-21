# Operating Systems and Computer Architecture

## Core model

A computer architecture describes the hardware-visible machine: instructions, registers, arithmetic units, memory, buses, and the hierarchy between fast small storage and slower large storage. An operating system manages those resources and gives programs safer, more convenient abstractions such as processes, virtual memory, files, and system calls.

The CPU repeatedly fetches an instruction, decodes it, executes it, and updates the program counter. Registers hold very fast working state. Main memory holds active program data and instructions, while caches keep likely-to-be-reused data closer to the CPU.

The operating system kernel is the privileged part of the OS. Programs request protected operations through system calls instead of directly controlling devices or arbitrary memory. A process is a running program with its own address space; threads are execution paths inside a process that share much of that process's state. The scheduler chooses which runnable thread gets CPU time.

Virtual memory gives each process an address-space abstraction. Pages can be mapped to physical frames, protected, shared, or temporarily moved to secondary storage. A page fault is a control-flow event caused by accessing a page that is not currently mapped as required; it is not automatically a crash.

Files are persistent named data abstractions managed by the OS. Device drivers translate between generic OS operations and hardware-specific protocols.

## Common boundaries

- Architecture defines what the machine can execute; the OS decides how to multiplex and protect it.
- A process is not the same thing as a program file.
- A virtual address is not necessarily a physical RAM address.
- A cache speeds access to data already represented in the memory hierarchy; it does not replace the OS's virtual-memory abstraction.
- A system call is a controlled transition into kernel services, not merely an ordinary function call.

## Candidate retrieval checks

- Trace an instruction from fetch through execution.
- Predict what changes during a context switch.
- Explain why caches help locality.
- Distinguish a virtual address, physical address, and page fault.
- Explain why applications use system calls.
