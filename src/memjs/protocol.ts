/** MemJS Memcache binary protocol errors */
export const errors: { [key: number]: string } = {};
errors[0x0000] = "No error";
errors[0x0001] = "Key not found";
errors[0x0002] = "Key exists";
errors[0x0003] = "Value too large";
errors[0x0004] = "Invalid arguments";
errors[0x0005] = "Item not stored";
errors[0x0006] = "Incr/Decr on non-numeric value";
errors[0x0007] = "The vbucket belongs to another server";
errors[0x0008] = "Authentication error";
errors[0x0009] = "Authentication continue";
errors[0x0081] = "Unknown command";
errors[0x0082] = "Out of memory";
errors[0x0083] = "Not supported";
errors[0x0084] = "Internal error";
errors[0x0085] = "Busy";
errors[0x0086] = "Temporary failure";
