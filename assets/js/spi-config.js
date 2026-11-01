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
    { id: 'colleghi-1', from: 'colleghi', file: 'p3-colleghi-1.mp4', phase: 'start', text: "Hi! I'm Claudia, I work here at the Acme Shop too. Nice to meet you!" },
    { id: 'colleghi-2', from: 'colleghi', file: 'p3-colleghi-2.mp4', phase: 'middle', text: "Hey, today is a day full of orders, huh? Come on, we're managing!" },
    { id: 'colleghi-3', from: 'colleghi', file: 'p3-colleghi-3.mp4', phase: ['middle', 'end'], text: 'Hi! I wanted to tell you something: with you on shift, the work really goes well.' },
    { id: 'colleghi-4', from: 'colleghi', file: 'p3-colleghi-4.mp4', phase: ['middle', 'end'], text: "I'm just sending you a quick hello! I know it's a long task, but we're managing well." },
    { id: 'clienti-1', from: 'clienti', file: 'p3-clienti-1.mp4', phase: 'start', text: 'Good morning, I have just placed an order on the site. Thank you, and I wish you a good day.' },
    { id: 'clienti-2', from: 'clienti', file: 'p3-clienti-2.mp4', phase: 'middle', text: 'Hi! I imagine you have a lot to do today, so thank you so much for your kindness!' },
    { id: 'clienti-3', from: 'clienti', file: 'p3-clienti-3.mp4', phase: ['middle', 'end'], text: 'Hello! I just wanted to say thank you for the time you dedicated to me, really kind of you!' },
    { id: 'clienti-4', from: 'clienti', file: 'p3-clienti-4.mp4', phase: 'end', text: 'Hey, I wanted to send a hello to whoever is behind the screen. Enjoy your work, and have a good day!' }
  ]
  /* Italian originals, kept for the Italian remake of the videos (the captions above are their English translations):
     colleghi-1  Ciao! Sono Claudia, lavoro anch'io qui all'Acme Shop. Piacere di conoscerti!
     colleghi-2  Ehi, oggi è una giornata piena di ordini, eh? Dai che ce la stiamo cavando!
     colleghi-3  Ciao! Volevo dirti una cosa: con te in turno si lavora proprio bene.
     colleghi-4  Ti mando solo un saluto veloce! Lo so che è un compito lungo, ma ce la stiamo cavando bene.
     clienti-1   Buongiorno, ho appena fatto un ordine sul sito. Vi ringrazio e vi auguro una buona giornata.
     clienti-2   Ciao! Immagino che oggi abbiate un sacco da fare, quindi grazie mille per la gentilezza!
     clienti-3   Salve! Volevo solo dirti grazie per il tempo che mi hai dedicato, davvero gentile da parte tua!
     clienti-4   Ehi, volevo mandare un saluto a chi c'è dietro lo schermo. Buon lavoro e buona giornata! */
};
