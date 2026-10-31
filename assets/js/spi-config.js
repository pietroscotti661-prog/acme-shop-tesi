/* Small positive interactions: pool of video + phrase pairs and timing.
   Used by spi-popup.js in obj_spi_colleghi, obj_spi_clienti and obj_spi_test_cond only.
   from    = who speaks: "colleghi" or "clienti" (colleagues or customers)
   file    = video in assets/video (portrait 4:5, no burned-in captions)
   text    = the caption shown over the video (the phrase the person says)
   phase   = when in the task it fits: "start" (orders 1-11), "middle" (12-22), "end" (23-33) or "any"; a list such as ["middle", "end"] also works
   Each participant sees a random clip of the right source and phase, not repeated until the pool is used up. */
window.SPI = {
  at: 30,                // seconds left on the order countdown when the pop-up appears
  orders: [6, 15, 24],   // 'all' or a list of order numbers; 6, 15, 24 = about 4:10, 8:40 and 13:10 into the task
  phases: { start: [1, 11], middle: [12, 22], end: [23, 33] },
  pool: [
    { id: 'colleghi-1', from: 'colleghi', file: 'p3-colleghi-1.mp4', phase: 'start', text: "Ciao! Sono Claudia, lavoro anch'io qui all'Acme Shop. Piacere di conoscerti!" },
    { id: 'colleghi-2', from: 'colleghi', file: 'p3-colleghi-2.mp4', phase: 'middle', text: 'Ehi, oggi è una giornata piena di ordini, eh? Dai che ce la stiamo cavando!' },
    { id: 'colleghi-3', from: 'colleghi', file: 'p3-colleghi-3.mp4', phase: ['middle', 'end'], text: 'Ciao! Volevo dirti una cosa: con te in turno si lavora proprio bene.' },
    { id: 'colleghi-4', from: 'colleghi', file: 'p3-colleghi-4.mp4', phase: ['middle', 'end'], text: 'Ti mando solo un saluto veloce! Lo so che è un compito lungo, ma ce la stiamo cavando bene.' },
    { id: 'clienti-1', from: 'clienti', file: 'p3-clienti-1.mp4', phase: 'start', text: 'Buongiorno, ho appena fatto un ordine sul sito. Vi ringrazio e vi auguro una buona giornata.' },
    { id: 'clienti-2', from: 'clienti', file: 'p3-clienti-2.mp4', phase: 'middle', text: 'Ciao! Immagino che oggi abbiate un sacco da fare, quindi grazie mille per la gentilezza!' }
  ]
};
