(function () {
  var width = 48;
  var height = 48;
  var bytes = new Uint8Array(3 + ((width * height) >> 3));
  var x;
  var y;

  bytes[0] = width;
  bytes[1] = height;
  bytes[2] = 1;
  for (y = 4; y < 44; y += 1) {
    for (x = 4; x < 44; x += 1) {
      if (
        x === 4 ||
        x === 43 ||
        y === 4 ||
        y === 43 ||
        (x > 13 && x < 34 && y > 17 && y < 31)
      ) {
        var pixel = y * width + x;
        bytes[3 + (pixel >> 3)] |= 128 >> (pixel & 7);
      }
    }
  }
  return bytes.buffer;
})();

