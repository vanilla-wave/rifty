// The 300×200 RGBA image of step 3.
module.exports = (png) => {
  for (let i = 0; i < png.data.length; i++) png.data[i] = ((i * 7) % 256) ^ (i >> 9);
  return png;
};
