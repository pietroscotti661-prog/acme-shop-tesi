/* Small positive interactions: pool of video + phrase pairs and timing.
   Used by spi-popup.js in obj_spi_colleghi, obj_spi_clienti and obj_spi_test_cond only.
   from    = who speaks: "colleghi" or "clienti" (colleagues or customers)
   file    = video in assets/video
   phase   = when in the task it fits: "start" (orders 1-11), "middle" (12-22), "end" (23-33) or "any"; a list such as ["middle", "end"] also works
   Each participant sees a random clip of the right source and phase, not repeated until the pool is used up. */
window.SPI = {
  at: 30,                // seconds left on the order countdown when the pop-up appears
  orders: [6, 15, 24],   // 'all' or a list of order numbers; 6, 15, 24 = about 4:10, 8:40 and 13:10 into the task
  phases: { start: [1, 11], middle: [12, 22], end: [23, 33] },
  pool: [
    { id: 'colleghi-1', from: 'colleghi', file: 'p2-colleghi-1.mp4', phase: 'start' },
    { id: 'colleghi-2', from: 'colleghi', file: 'p2-colleghi-2.mp4', phase: 'middle' },
    { id: 'colleghi-3', from: 'colleghi', file: 'p2-colleghi-3.mp4', phase: ['middle', 'end'] },
    { id: 'colleghi-4', from: 'colleghi', file: 'p2-colleghi-4.mp4', phase: ['middle', 'end'] },
    { id: 'clienti-1', from: 'clienti', file: 'p2-clienti-1.mp4', phase: 'start' },
    { id: 'clienti-2', from: 'clienti', file: 'p2-clienti-2.mp4', phase: 'middle' },
    { id: 'clienti-4', from: 'clienti', file: 'p2-clienti-4.mp4', phase: 'any' }
  ]
};
