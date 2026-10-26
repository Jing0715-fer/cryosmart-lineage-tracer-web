"""Byte-level validation of the __csZipStore output produced by /ziptest.

Run AFTER: curl http://localhost:3021/ziptest
Validates: EOCD/central-directory structure, CRC32 of every entry, STORE
method, UTF-8 (0x0800 flag) filenames, and byte-exact content vs the
expected payloads written by the service.
"""
import sys
import zipfile

z = zipfile.ZipFile("/tmp/ziptest/out.zip")
bad = z.testzip()
if bad is not None:
    print("CRC FAIL:", bad)
    sys.exit(1)
names = z.namelist()
print("entries:", names)
assert "dir/J606.volume.map" in names
assert "J606.fsc.xml" in names
assert "empty.txt" in names
utf8_name = [n for n in names if "\u62a5\u544a" in n]
assert utf8_name, "UTF-8 filename entry missing"
assert z.read("J606.fsc.xml") == b"hello zip\nline2\n"
assert z.read("empty.txt") == b""
assert z.read("dir/J606.volume.map") == open("/tmp/ziptest/expected_big.bin", "rb").read()
assert z.read(utf8_name[0]) == open("/tmp/ziptest/expected_mid.bin", "rb").read()
infos = {i.filename: i for i in z.infolist()}
assert infos["dir/J606.volume.map"].compress_type == zipfile.ZIP_STORED
assert infos["empty.txt"].file_size == 0
assert infos["J606.fsc.xml"].flag_bits & 0x800, "UTF-8 name flag (0x0800) not set"
print("ZIP VERIFY OK: structure + CRC32 + STORE + UTF-8 names + byte-exact content")
