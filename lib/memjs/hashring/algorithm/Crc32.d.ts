/*!
 * A crc32 function that will produce the same result as PHP's crc32() function
 * (http://php.net/crc32).
 *
 * The string used in PHP must be encoded in UTF-8 or the checksums will be
 * different. Use the following PHP to get the unsigned integer result:
 *
 *     sprintf('%u', crc32($string));
 *
 * Copyright 2010, Will Bond <will@wbond.net>
 * Released under the MIT license
 */
export default function (string: any): number;
