// Objectifying orders: once "Send the order" is pressed, the order is final.
// Fields are locked until the timer moves on to the next order (presentation of "order sent", no timing change).
(function () {
  document.addEventListener('DOMContentLoaded', function () {
    var btn = document.getElementById('evadi');
    if (!btn) return;
    btn.addEventListener('click', function () {
      if (document.body.className.indexOf('acme-sent') !== -1) return;
      document.body.className += ' acme-sent';
      var fields = document.querySelectorAll('#ordine select, #ordine input, #ordine textarea, #ordine button');
      for (var i = 0; i < fields.length; i++) {
        if (fields[i].id !== 'evadi') fields[i].disabled = true;
      }
      btn.setAttribute('aria-disabled', 'true');
    });
  });
})();
