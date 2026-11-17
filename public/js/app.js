(function () {
  // Galería de la ficha de producto: al tocar una miniatura se cambia la foto principal.
  var main = document.getElementById('main-photo');
  var thumbs = document.querySelectorAll('[data-thumb]');
  thumbs.forEach(function (thumb) {
    thumb.addEventListener('click', function (event) {
      if (!main) return;
      event.preventDefault();
      main.src = thumb.getAttribute('href');
      thumbs.forEach(function (t) {
        t.classList.remove('active');
      });
      thumb.classList.add('active');
    });
  });

  // Selectores que envían su formulario al cambiar (orden, disponibilidad).
  document.querySelectorAll('select[data-autosubmit]').forEach(function (select) {
    select.addEventListener('change', function () {
      if (select.form) select.form.submit();
    });
  });

  // Confirmación antes de acciones que no se pueden deshacer.
  document.querySelectorAll('form[data-confirm]').forEach(function (form) {
    form.addEventListener('submit', function (event) {
      if (!window.confirm(form.getAttribute('data-confirm'))) event.preventDefault();
    });
  });

  // ---------- Subida de fotos en el panel ----------
  // Cada foto se reduce en el navegador (completa + miniatura). Al volver a dibujarla se pierden
  // los metadatos (ubicación GPS, cámara), y pesa poco: así cabe en el límite de 4,5 MB de Vercel.
  document.querySelectorAll('[data-photo-uploader]').forEach(initUploader);

  function initUploader(root) {
    var input = root.querySelector('[data-photo-input]');
    var list = root.querySelector('[data-photo-list]');
    var status = root.querySelector('[data-photo-status]');
    var form = root.closest('form');
    var submit = form && form.querySelector('button[type="submit"]');
    var max = parseInt(root.getAttribute('data-max'), 10) || 0;
    var fullSide = parseInt(root.getAttribute('data-full'), 10) || 1600;
    var thumbSide = parseInt(root.getAttribute('data-thumb'), 10) || 480;
    var busy = 0;

    function setBusy(delta) {
      busy += delta;
      if (submit) submit.disabled = busy > 0;
    }

    function pendingCount() {
      return list.querySelectorAll('[data-pending]').length;
    }

    function loadImage(file) {
      return new Promise(function (resolve, reject) {
        var url = URL.createObjectURL(file);
        var img = new Image();
        img.onload = function () {
          URL.revokeObjectURL(url);
          resolve(img);
        };
        img.onerror = function () {
          URL.revokeObjectURL(url);
          reject(new Error('no se pudo leer la imagen'));
        };
        img.src = url;
      });
    }

    function readFile(file) {
      if (window.createImageBitmap) {
        return createImageBitmap(file).catch(function () {
          return loadImage(file);
        });
      }
      return loadImage(file);
    }

    function toJpeg(source, maxSide, quality) {
      var scale = Math.min(1, maxSide / Math.max(source.width, source.height));
      var width = Math.max(1, Math.round(source.width * scale));
      var height = Math.max(1, Math.round(source.height * scale));
      var canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      var ctx = canvas.getContext('2d');
      ctx.fillStyle = '#ffffff'; // los PNG con transparencia quedan sobre fondo blanco
      ctx.fillRect(0, 0, width, height);
      ctx.drawImage(source, 0, 0, width, height);
      return new Promise(function (resolve, reject) {
        canvas.toBlob(
          function (blob) {
            blob ? resolve(blob) : reject(new Error('no se pudo procesar la foto'));
          },
          'image/jpeg',
          quality
        );
      });
    }

    function send(blob, variant) {
      return fetch('/admin/fotos?v=' + variant, {
        method: 'POST',
        headers: { 'Content-Type': 'image/jpeg' },
        body: blob,
        credentials: 'same-origin'
      }).then(function (response) {
        return response
          .json()
          .catch(function () {
            return {};
          })
          .then(function (data) {
            if (!response.ok || !data.url) throw new Error(data.error || 'no se pudo subir la foto');
            return data.url;
          });
      });
    }

    function addPending(fullUrl, thumbUrl) {
      var item = document.createElement('div');
      item.className = 'photo-item';
      item.setAttribute('data-pending', '');

      var frame = document.createElement('div');
      frame.className = 'photo-frame';
      var img = document.createElement('img');
      img.src = thumbUrl;
      img.alt = 'Foto nueva';
      var badge = document.createElement('span');
      badge.className = 'badge';
      badge.textContent = 'Nueva';
      frame.appendChild(img);
      frame.appendChild(badge);

      var hidden = document.createElement('input');
      hidden.type = 'hidden';
      hidden.name = 'foto';
      hidden.value = fullUrl + '|' + thumbUrl;

      var actions = document.createElement('div');
      actions.className = 'photo-actions';
      var remove = document.createElement('button');
      remove.type = 'button';
      remove.className = 'btn btn-danger btn-sm';
      remove.setAttribute('data-remove-pending', '');
      remove.textContent = 'Quitar';
      actions.appendChild(remove);

      item.appendChild(frame);
      item.appendChild(hidden);
      item.appendChild(actions);
      list.appendChild(item);
    }

    list.addEventListener('click', function (event) {
      var button = event.target.closest('[data-remove-pending]');
      if (!button) return;
      var item = button.closest('[data-pending]');
      var parts = item.querySelector('input[name="foto"]').value.split('|');
      item.remove();
      // Se borra del almacenamiento (si falla, no pasa nada: solo queda una foto sin usar).
      fetch('/admin/fotos/quitar', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ url: parts[0], thumb: parts[1] || '' }),
        credentials: 'same-origin'
      }).catch(function () {});
    });

    input.addEventListener('change', async function () {
      var files = Array.prototype.slice.call(input.files || []);
      input.value = '';
      if (!files.length) return;

      var room = Math.max(0, max - pendingCount());
      var notes = [];
      if (files.length > room) {
        notes.push('Solo caben ' + room + ' foto(s) más en este producto.');
        files = files.slice(0, room);
      }

      setBusy(1);
      var uploaded = 0;
      for (var i = 0; i < files.length; i++) {
        status.textContent = 'Subiendo foto ' + (i + 1) + ' de ' + files.length + '…';
        try {
          var source = await readFile(files[i]);
          var fullBlob = await toJpeg(source, fullSide, 0.82);
          var thumbBlob = await toJpeg(source, thumbSide, 0.78);
          if (source.close) source.close();
          var fullUrl = await send(fullBlob, 'full');
          var thumbUrl = await send(thumbBlob, 'thumb');
          addPending(fullUrl, thumbUrl);
          uploaded++;
        } catch (err) {
          notes.push(files[i].name + ': ' + err.message + '.');
        }
      }
      setBusy(-1);

      var summary = uploaded ? uploaded + ' foto(s) lista(s). Falta guardar el producto.' : '';
      status.textContent = [summary].concat(notes).filter(Boolean).join(' ');
    });
  }
})();
