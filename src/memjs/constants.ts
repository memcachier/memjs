/*
Constants from memcached binary protocol docs
https://github.com/couchbase/memcached/blob/master/docs/BinaryProtocol.md#0x0d-getkq-get-with-key-quietly

Note: not all constants in here are implemented in this library, not all constants from the docs are included here
*/

export const OP_GET = 0x00;
export const OP_SET = 0x01;
export const OP_ADD = 0x02;
export const OP_REPLACE = 0x03;
export const OP_DELETE = 0x04;
export const OP_INCREMENT = 0x05;
export const OP_DECREMENT = 0x06;
export const OP_QUIT = 0x07;
export const OP_FLUSH = 0x08;
export const OP_GETQ = 0x09;
export const OP_NO_OP = 0x0a;
export const OP_VERSION = 0x0b;
export const OP_GETK = 0x0c;
export const OP_GETKQ = 0x0d;
export const OP_APPEND = 0x0e;
export const OP_PREPEND = 0x0f;
export const OP_STAT = 0x10;
export const OP_SETQ = 0x11;
export const OP_ADDQ = 0x12;
export const OP_REPLACEQ = 0x13;
export const OP_DELETEQ = 0x14;
export const OP_INCREMENTQ = 0x15;
export const OP_DECREMENTQ = 0x16;
export const OP_QUITQ = 0x17;
export const OP_FLUSHQ = 0x18;
export const OP_APPENDQ = 0x19;
export const OP_PREPENDQ = 0x1a;
export const OP_VERBOSITY = 0x1b;
export const OP_TOUCH = 0x1c;
export const OP_GAT = 0x1d;
export const OP_GATQ = 0x1e;
export const OP_HELO = 0x1f;
export const OP_SASL_LIST_MECHS = 0x20;
export const OP_SASL_AUTH = 0x21;
export const OP_SASL_STEP = 0x22;
export const OP_IOCTL_GET = 0x23;
export const OP_IOCTL_SET = 0x24;
export const OP_CONFIG_VALIDATE = 0x25;
export const OP_CONFIG_RELOAD = 0x26;
export const OP_AUDIT_PUT = 0x27;
export const OP_AUDIT_CONFIG_RELOAD = 0x28;
export const OP_SHUTDOWN = 0x29;
export const OP_RGET = 0x30;
export const OP_RSET = 0x31;
export const OP_RSETQ = 0x32;
export const OP_RAPPEND = 0x33;
export const OP_RAPPENDQ = 0x34;
export const OP_RPREPEND = 0x35;
export const OP_RPREPENDQ = 0x36;
export const OP_RDELETE = 0x37;
export const OP_RDELETEQ = 0x38;
export const OP_RINCR = 0x39;
export const OP_RINCRQ = 0x3a;
export const OP_RDECR = 0x3b;
export const OP_RDECRQ = 0x3c;
export const OP_SET_VBUCKET = 0x3d;
export const OP_GET_VBUCKET = 0x3e;
export const OP_DEL_VBUCKET = 0x3f;
export const OP_TAP_CONNECT = 0x40;
export const OP_TAP_MUTATION = 0x41;
export const OP_TAP_DELETE = 0x42;
export const OP_TAP_FLUSH = 0x43;
export const OP_TAP_OPAQUE = 0x44;
export const OP_TAP_VBUCKET_SET = 0x45;
export const OP_TAP_CHECKOUT_START = 0x46;
export const OP_TAP_CHECKPOINT_END = 0x47;
export const OP_GET_ALL_VB_SEQNOS = 0x48;
export const OP_DCP_OPEN = 0x50;
export const OP_DCP_ADD_STREAM = 0x51;
export const OP_DCP_CLOSE_STREAM = 0x52;
export const OP_DCP_STREAM_REQ = 0x53;
export const OP_DCP_GET_FAILOVER_LOG = 0x54;
export const OP_DCP_STREAM_END = 0x55;
export const OP_DCP_SNAPSHOT_MARKER = 0x56;
export const OP_DCP_MUTATION = 0x57;
export const OP_DCP_DELETION = 0x58;
export const OP_DCP_EXPIRATION = 0x59;
export const OP_DCP_FLUSH = 0x5a;
export const OP_DCP_SET_VBUCKET_STATE = 0x5b;
export const OP_DCP_NOOP = 0x5c;
export const OP_DCP_BUFFER_ACKNOWLEDGEMENT = 0x5d;
export const OP_DCP_CONTROL = 0x5e;
export const OP_DCP_RESERVED4 = 0x5f;
export const OP_STOP_PERSISTENCE = 0x80;
export const OP_START_PERSISTENCE = 0x81;
export const OP_SET_PARAM = 0x82;
export const OP_GET_REPLICA = 0x83;
export const OP_CREATE_BUCKET = 0x85;
export const OP_DELETE_BUCKET = 0x86;
export const OP_LIST_BUCKETS = 0x87;
export const OP_SELECT_BUCKET = 0x89;
export const OP_ASSUME_ROLE = 0x8a;
export const OP_OBSERVE_SEQNO = 0x91;
export const OP_OBSERVE = 0x92;
export const OP_EVICT_KEY = 0x93;
export const OP_GET_LOCKED = 0x94;
export const OP_UNLOCK_KEY = 0x95;
export const OP_LAST_CLOSED_CHECKPOINT = 0x97;
export const OP_DEREGISTER_TAP_CLIENT = 0x9e;
export const OP_RESET_REPLICATION_CHAIN = 0x9f;
export const OP_GET_META = 0xa0;
export const OP_GETQ_META = 0xa1;
export const OP_SET_WITH_META = 0xa2;
export const OP_SETQ_WITH_META = 0xa3;
export const OP_ADD_WITH_META = 0xa4;
export const OP_ADDQ_WITH_META = 0xa5;
export const OP_SNAPSHOT_VB_STATES = 0xa6;
export const OP_VBUCKET_BATCH_COUNT = 0xa7;
export const OP_DEL_WITH_META = 0xa8;
export const OP_DELQ_WITH_META = 0xa9;
export const OP_CREATE_CHECKPOINT = 0xaa;
export const OP_NOTIFY_VBUCKET_UPDATE = 0xac;
export const OP_ENABLE_TRAFFIC = 0xad;
export const OP_DISABLE_TRAFFIC = 0xae;
export const OP_CHANGE_VB_FILTER = 0xb0;
export const OP_CHECKPOINT_PERSISTENCE = 0xb1;
export const OP_RETURN_META = 0xb2;
export const OP_COMPACT_DB = 0xb3;
export const OP_SET_CLUSTER_CONFIG = 0xb4;
export const OP_GET_CLUSTER_CONFIG = 0xb5;
export const OP_GET_RANDOM_KEY = 0xb6;
export const OP_SEQNO_PERSISTENCE = 0xb7;
export const OP_GET_KEYS = 0xb8;
export const OP_SET_DRIFT_COUNTER_STATE = 0xc1;
export const OP_GET_ADJUSTED_TIME = 0xc2;
export const OP_SUBDOC_GET = 0xc5;
export const OP_SUBDOC_EXISTS = 0xc6;
export const OP_SUBDOC_DICT_ADD = 0xc7;
export const OP_SUBDOC_DICT_UPSERT = 0xc8;
export const OP_SUBDOC_DELETE = 0xc9;
export const OP_SUBDOC_REPLACE = 0xca;
export const OP_SUBDOC_ARRAY_PUSH_LAST = 0xcb;
export const OP_SUBDOC_ARRAY_PUSH_FIRST = 0xcc;
export const OP_SUBDOC_ARRAY_INSERT = 0xcd;
export const OP_SUBDOC_ARRAY_ADD_UNIQUE = 0xce;
export const OP_SUBDOC_COUNTER = 0xcf;
export const OP_SUBDOC_MULTI_LOOKUP = 0xd0;
export const OP_SUBDOC_MULTI_MUTATION = 0xd1;
export const OP_SUBDOC_GET_COUNT = 0xd2;
export const OP_SCRUB = 0xf0;
export const OP_ISASL_REFRESH = 0xf1;
export const OP_SSL_CERTS_REFRESH = 0xf2;
export const OP_GET_CMD_TIMER = 0xf3;
export const OP_SET_CTRL_TOKEN = 0xf4;
export const OP_GET_CTRL_TOKEN = 0xf5;
export const OP_INIT_COMPLETE = 0xf6;

export type OP =
  | typeof OP_GET
  | typeof OP_SET
  | typeof OP_ADD
  | typeof OP_REPLACE
  | typeof OP_DELETE
  | typeof OP_INCREMENT
  | typeof OP_DECREMENT
  | typeof OP_QUIT
  | typeof OP_FLUSH
  | typeof OP_GETQ
  | typeof OP_NO_OP
  | typeof OP_VERSION
  | typeof OP_GETK
  | typeof OP_GETKQ
  | typeof OP_APPEND
  | typeof OP_PREPEND
  | typeof OP_STAT
  | typeof OP_SETQ
  | typeof OP_ADDQ
  | typeof OP_REPLACEQ
  | typeof OP_DELETEQ
  | typeof OP_INCREMENTQ
  | typeof OP_DECREMENTQ
  | typeof OP_QUITQ
  | typeof OP_FLUSHQ
  | typeof OP_APPENDQ
  | typeof OP_PREPENDQ
  | typeof OP_VERBOSITY
  | typeof OP_TOUCH
  | typeof OP_GAT
  | typeof OP_GATQ
  | typeof OP_HELO
  | typeof OP_SASL_LIST_MECHS
  | typeof OP_SASL_AUTH
  | typeof OP_SASL_STEP
  | typeof OP_IOCTL_GET
  | typeof OP_IOCTL_SET
  | typeof OP_CONFIG_VALIDATE
  | typeof OP_CONFIG_RELOAD
  | typeof OP_AUDIT_PUT
  | typeof OP_AUDIT_CONFIG_RELOAD
  | typeof OP_SHUTDOWN
  | typeof OP_RGET
  | typeof OP_RSET
  | typeof OP_RSETQ
  | typeof OP_RAPPEND
  | typeof OP_RAPPENDQ
  | typeof OP_RPREPEND
  | typeof OP_RPREPENDQ
  | typeof OP_RDELETE
  | typeof OP_RDELETEQ
  | typeof OP_RINCR
  | typeof OP_RINCRQ
  | typeof OP_RDECR
  | typeof OP_RDECRQ
  | typeof OP_SET_VBUCKET
  | typeof OP_GET_VBUCKET
  | typeof OP_DEL_VBUCKET
  | typeof OP_TAP_CONNECT
  | typeof OP_TAP_MUTATION
  | typeof OP_TAP_DELETE
  | typeof OP_TAP_FLUSH
  | typeof OP_TAP_OPAQUE
  | typeof OP_TAP_VBUCKET_SET
  | typeof OP_TAP_CHECKOUT_START
  | typeof OP_TAP_CHECKPOINT_END
  | typeof OP_GET_ALL_VB_SEQNOS
  | typeof OP_DCP_OPEN
  | typeof OP_DCP_ADD_STREAM
  | typeof OP_DCP_CLOSE_STREAM
  | typeof OP_DCP_STREAM_REQ
  | typeof OP_DCP_GET_FAILOVER_LOG
  | typeof OP_DCP_STREAM_END
  | typeof OP_DCP_SNAPSHOT_MARKER
  | typeof OP_DCP_MUTATION
  | typeof OP_DCP_DELETION
  | typeof OP_DCP_EXPIRATION
  | typeof OP_DCP_FLUSH
  | typeof OP_DCP_SET_VBUCKET_STATE
  | typeof OP_DCP_NOOP
  | typeof OP_DCP_BUFFER_ACKNOWLEDGEMENT
  | typeof OP_DCP_CONTROL
  | typeof OP_DCP_RESERVED4
  | typeof OP_STOP_PERSISTENCE
  | typeof OP_START_PERSISTENCE
  | typeof OP_SET_PARAM
  | typeof OP_GET_REPLICA
  | typeof OP_CREATE_BUCKET
  | typeof OP_DELETE_BUCKET
  | typeof OP_LIST_BUCKETS
  | typeof OP_SELECT_BUCKET
  | typeof OP_ASSUME_ROLE
  | typeof OP_OBSERVE_SEQNO
  | typeof OP_OBSERVE
  | typeof OP_EVICT_KEY
  | typeof OP_GET_LOCKED
  | typeof OP_UNLOCK_KEY
  | typeof OP_LAST_CLOSED_CHECKPOINT
  | typeof OP_DEREGISTER_TAP_CLIENT
  | typeof OP_RESET_REPLICATION_CHAIN
  | typeof OP_GET_META
  | typeof OP_GETQ_META
  | typeof OP_SET_WITH_META
  | typeof OP_SETQ_WITH_META
  | typeof OP_ADD_WITH_META
  | typeof OP_ADDQ_WITH_META
  | typeof OP_SNAPSHOT_VB_STATES
  | typeof OP_VBUCKET_BATCH_COUNT
  | typeof OP_DEL_WITH_META
  | typeof OP_DELQ_WITH_META
  | typeof OP_CREATE_CHECKPOINT
  | typeof OP_NOTIFY_VBUCKET_UPDATE
  | typeof OP_ENABLE_TRAFFIC
  | typeof OP_DISABLE_TRAFFIC
  | typeof OP_CHANGE_VB_FILTER
  | typeof OP_CHECKPOINT_PERSISTENCE
  | typeof OP_RETURN_META
  | typeof OP_COMPACT_DB
  | typeof OP_SET_CLUSTER_CONFIG
  | typeof OP_GET_CLUSTER_CONFIG
  | typeof OP_GET_RANDOM_KEY
  | typeof OP_SEQNO_PERSISTENCE
  | typeof OP_GET_KEYS
  | typeof OP_SET_DRIFT_COUNTER_STATE
  | typeof OP_GET_ADJUSTED_TIME
  | typeof OP_SUBDOC_GET
  | typeof OP_SUBDOC_EXISTS
  | typeof OP_SUBDOC_DICT_ADD
  | typeof OP_SUBDOC_DICT_UPSERT
  | typeof OP_SUBDOC_DELETE
  | typeof OP_SUBDOC_REPLACE
  | typeof OP_SUBDOC_ARRAY_PUSH_LAST
  | typeof OP_SUBDOC_ARRAY_PUSH_FIRST
  | typeof OP_SUBDOC_ARRAY_INSERT
  | typeof OP_SUBDOC_ARRAY_ADD_UNIQUE
  | typeof OP_SUBDOC_COUNTER
  | typeof OP_SUBDOC_MULTI_LOOKUP
  | typeof OP_SUBDOC_MULTI_MUTATION
  | typeof OP_SUBDOC_GET_COUNT
  | typeof OP_SCRUB
  | typeof OP_ISASL_REFRESH
  | typeof OP_SSL_CERTS_REFRESH
  | typeof OP_GET_CMD_TIMER
  | typeof OP_SET_CTRL_TOKEN
  | typeof OP_GET_CTRL_TOKEN
  | typeof OP_INIT_COMPLETE;

/**
 * Response statuses
 * https://github.com/memcached/memcached/wiki/BinaryProtocolRevamped#response-status
 */
export const ResponseStatus = {
  /** Named "No error" in the memcached docs, but clearer in code as "SUCCESS". */
  SUCCESS: 0x0000,
  KEY_NOT_FOUND: 0x0001,
  KEY_EXISTS: 0x0002,
  VALUE_TOO_LARGE: 0x0003,
  INVALID_ARGUMENTS: 0x0004,
  ITEM_NOT_STORED: 0x0005,
  INCR_DECR_ON_NON_NUMERIC_VALUE: 0x0006,
  THE_VBUCKET_BELONGS_TO_ANOTHER_SERVER: 0x0007,
  AUTHENTICATION_ERROR: 0x0008,
  AUTHENTICATION_CONTINUE: 0x0009,
  UNKNOWN_COMMAND: 0x0081,
  OUT_OF_MEMORY: 0x0082,
  NOT_SUPPORTED: 0x0083,
  INTERNAL_ERROR: 0x0084,
  BUSY: 0x0085,
  TEMPORARY_FAILURE: 0x0086,
} as const;

export type ResponseStatus = typeof ResponseStatus[keyof typeof ResponseStatus];

export function responseStatusToString(
  responseStatus: ResponseStatus | undefined
) {
  switch (responseStatus) {
    case 0x0000:
      return "No error";
    case 0x0001:
      return "Key not found";
    case 0x0002:
      return "Key exists";
    case 0x0003:
      return "Value too large";
    case 0x0004:
      return "Invalid arguments";
    case 0x0005:
      return "Item not stored";
    case 0x0006:
      return "Incr/Decr on non-numeric value";
    case 0x0007:
      return "The vbucket belongs to another server";
    case 0x0008:
      return "Authentication error";
    case 0x0009:
      return "Authentication continue";
    case 0x0081:
      return "Unknown command";
    case 0x0082:
      return "Out of memory";
    case 0x0083:
      return "Not supported";
    case 0x0084:
      return "Internal error";
    case 0x0085:
      return "Busy";
    case 0x0086:
      return "Temporary failure";
    default:
      return `Unknown response status ${responseStatus}`;
  }
}
