(() => {
  'use strict';
  const cfg = window.KAL_CONFIG || {};
  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
  const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
  const validHttpUrl = value => {
    const raw = String(value ?? '').trim();
    if (!raw || raw.startsWith('//')) return null;
    try {
      const u = new URL(raw, window.location.origin);
      const absolute = /^https?:\/\//i.test(raw);
      const sameSitePath = raw.startsWith('/') && !raw.startsWith('//');
      return ['http:','https:'].includes(u.protocol) && (absolute || sameSitePath) ? u : null;
    } catch { return null; }
  };
  const safeExternal = value => { const u = validHttpUrl(value); return u ? u.href : ''; };
  const toEmbed = (provider, value) => {
    const u = validHttpUrl(value);
    if (!u) return '';
    if (provider === 'soundcloud' && /(^|\.)soundcloud\.com$/i.test(u.hostname)) {
      return `https://w.soundcloud.com/player/?url=${encodeURIComponent(u.href)}&color=%2300cfff&auto_play=false&hide_related=true&show_comments=false&show_user=true&show_reposts=false&visual=true`;
    }
    if (provider === 'spotify' && /(^|\.)open\.spotify\.com$/i.test(u.hostname)) {
      u.pathname = u.pathname.replace(/^\/(?!embed\/)/, '/embed/');
      return u.href;
    }
    if (provider === 'youtube') {
      let id = '';
      if (u.hostname === 'youtu.be') id = u.pathname.slice(1).split('/')[0];
      else if (/youtube\.com$/i.test(u.hostname) || /youtube-nocookie\.com$/i.test(u.hostname)) {
        id = u.searchParams.get('v') || u.pathname.match(/\/(?:embed|shorts|live)\/([^/?]+)/)?.[1] || '';
        if (!id && u.pathname === '/playlist' && u.searchParams.get('list')) return `https://www.youtube.com/embed/videoseries?list=${encodeURIComponent(u.searchParams.get('list'))}`;
      }
      return id ? `https://www.youtube-nocookie.com/embed/${encodeURIComponent(id)}?rel=0` : '';
    }
    return '';
  };

  // Header, mobile navigation, scroll state.
  const header = $('.site-header');
  const menu = $('#mobile-menu');
  const menuToggle = $('#menu-toggle');
  const closeMenu = () => { menu?.classList.remove('open'); menu?.setAttribute('aria-hidden','true'); menuToggle?.setAttribute('aria-expanded','false'); };
  menuToggle?.addEventListener('click', () => {
    const open = !menu.classList.contains('open');
    menu.classList.toggle('open', open); menu.setAttribute('aria-hidden', String(!open)); menuToggle.setAttribute('aria-expanded', String(open));
  });
  $$('#mobile-menu a').forEach(link => link.addEventListener('click', closeMenu));
  const setHeader = () => header?.classList.toggle('scrolled', window.scrollY > 24);
  window.addEventListener('scroll', setHeader, {passive:true}); setHeader();

  // Three.js hero object: the canvas degrades safely when WebGL or the CDN is unavailable.
  function initScene() {
    const canvas = $('#bg');
    if (!canvas || !window.THREE || window.matchMedia('(prefers-reduced-motion: reduce)').matches || window.innerWidth < 560) return;
    try {
      const THREE = window.THREE;
      const scene = new THREE.Scene();
      const camera = new THREE.PerspectiveCamera(52, innerWidth / innerHeight, .1, 100);
      camera.position.set(0, 0, 6.3);
      const renderer = new THREE.WebGLRenderer({canvas, alpha:true, antialias:true, powerPreference:'low-power'});
      renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 1.7));
      renderer.setSize(innerWidth, innerHeight);
      renderer.setClearColor(0x000000, 0);
      const core = new THREE.Mesh(new THREE.IcosahedronGeometry(1.42, 2), new THREE.MeshPhysicalMaterial({color:0x06111e, metalness:.7, roughness:.22, transparent:true, opacity:.92, clearcoat:.9, clearcoatRoughness:.2}));
      const wire = new THREE.Mesh(new THREE.IcosahedronGeometry(1.45, 2), new THREE.MeshBasicMaterial({color:0x00cfff, wireframe:true, transparent:true, opacity:.23}));
      const shell = new THREE.Mesh(new THREE.IcosahedronGeometry(1.98, 1), new THREE.MeshBasicMaterial({color:0x00ff8a, wireframe:true, transparent:true, opacity:.075}));
      scene.add(core, wire, shell, new THREE.AmbientLight(0x6a91b1, .7));
      const cyanLight = new THREE.PointLight(0x00cfff, 7, 13); cyanLight.position.set(3,2,3); scene.add(cyanLight);
      const greenLight = new THREE.PointLight(0x00ff8a, 4, 11); greenLight.position.set(-3,-2,2); scene.add(greenLight);
      const count = innerWidth < 900 ? 500 : 1100;
      const positions = new Float32Array(count * 3);
      for (let i=0;i<positions.length;i++) positions[i]=(Math.random()-.5)*25;
      const geometry = new THREE.BufferGeometry(); geometry.setAttribute('position',new THREE.BufferAttribute(positions,3));
      const stars = new THREE.Points(geometry,new THREE.PointsMaterial({color:0x53dfff,size:.016,transparent:true,opacity:.35})); scene.add(stars);
      let tx=0,ty=0,mx=0,my=0,frame=0;
      window.addEventListener('pointermove', e => {tx=(e.clientX/innerWidth-.5)*.75;ty=(e.clientY/innerHeight-.5)*.6;},{passive:true});
      const resize = () => { camera.aspect=innerWidth/innerHeight;camera.updateProjectionMatrix();renderer.setSize(innerWidth,innerHeight);renderer.setPixelRatio(Math.min(devicePixelRatio||1,1.7)); };
      window.addEventListener('resize', resize, {passive:true});
      const render = () => {
        frame += .0025; mx += (tx-mx)*.025; my += (ty-my)*.025;
        core.rotation.x=frame*.65+my;core.rotation.y=frame*.9+mx;
        wire.rotation.copy(core.rotation);shell.rotation.x=-frame*.25;shell.rotation.y=-frame*.32;
        stars.rotation.y=frame*.08;cyanLight.position.x=Math.sin(frame*1.8)*3;cyanLight.position.y=Math.cos(frame*1.3)*2;
        renderer.render(scene,camera); requestAnimationFrame(render);
      };
      render();
    } catch (error) { console.warn('3D background unavailable; using static background.', error); }
  }
  initScene();

  // Scroll reveals.
  if ('IntersectionObserver' in window) {
    const observer = new IntersectionObserver(entries => entries.forEach(entry => {
      if (entry.isIntersecting) { entry.target.classList.add('in'); observer.unobserve(entry.target); }
    }), {threshold:.12});
    $$('.section-heading,.signal-item,.embed-card,.track-row,.product-card,.service-card,.process-list article').forEach(el => {el.classList.add('reveal');observer.observe(el);});
  } else $$('.reveal').forEach(el => el.classList.add('in'));

  // Social + featured players. No dead placeholder anchors are rendered.
  function renderChannels() {
    const socialNames = {instagram:'Instagram',soundcloud:'SoundCloud',spotify:'Spotify',youtube:'YouTube'};
    const channelRoot = $('#channel-links');
    const socialRoot = $('#social-list');
    const entries = Object.entries(cfg.socials || {}).filter(([,url]) => safeExternal(url));
    if (channelRoot) channelRoot.innerHTML = entries.map(([key,url]) => `<a class="channel-link" href="${escapeHtml(safeExternal(url))}" target="_blank" rel="noopener noreferrer">${escapeHtml(socialNames[key] || key)} <span>↗</span></a>`).join('');
    if (socialRoot) {
      let links = entries.map(([key,url]) => `<a href="${escapeHtml(safeExternal(url))}" target="_blank" rel="noopener noreferrer">${escapeHtml(socialNames[key] || key)} ↗</a>`);
      if (cfg.contactEmail && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cfg.contactEmail)) links.push(`<a href="mailto:${encodeURIComponent(cfg.contactEmail)}">Email ↗</a>`);
      if (cfg.whatsapp && /^\+?[0-9]{8,16}$/.test(cfg.whatsapp)) links.push(`<a href="https://wa.me/${cfg.whatsapp.replace(/\D/g,'')}" target="_blank" rel="noopener noreferrer">WhatsApp ↗</a>`);
      socialRoot.innerHTML = links.join('');
    }
  }
  function renderFeatured() {
    const root = $('#featured-embeds'); if (!root) return;
    const defs = [
      ['soundcloud','SoundCloud','TRACKS / PLAYLISTS',cfg.featured?.soundcloud],
      ['spotify','Spotify','RELEASES / PLAYLISTS',cfg.featured?.spotify],
      ['youtube','YouTube','VIDEOS / SESSIONS',cfg.featured?.youtube]
    ];
    const active = defs.filter(([type,, ,url]) => toEmbed(type,url));
    if (!active.length) {
      root.innerHTML = `<div class="embed-card" style="grid-column:1/-1"><div class="embed-head"><strong>Audio connections</strong><span>READY WHEN YOU ARE</span></div><div class="embed-placeholder"><b>Connect your sound.</b><small>Add your SoundCloud, Spotify or YouTube URLs in <code>assets/site-config.js</code> and the live players appear here.</small></div></div>`;
      return;
    }
    root.innerHTML = active.map(([type,label,sub,url]) => `<article class="embed-card"><div class="embed-head"><strong>${label}</strong><span>${sub}</span></div><iframe class="embed-frame" src="${escapeHtml(toEmbed(type,url))}" title="${label} player" loading="lazy" allow="autoplay; clipboard-write; encrypted-media; fullscreen; picture-in-picture" referrerpolicy="strict-origin-when-cross-origin"></iframe></article>`).join('');
  }
  renderChannels(); renderFeatured();

  // Portfolio playback uses one native audio instance at a time.
  const trackRoot = $('#track-list');
  let activeAudio = null, activeButton = null;
  function stopActive() {
    if (activeAudio) { activeAudio.pause(); activeAudio.currentTime=0; activeAudio=null; }
    if (activeButton) { activeButton.textContent='PLAY'; activeButton.closest('.track-row')?.classList.remove('playing'); activeButton=null; }
  }
  function renderTracks() {
    if (!trackRoot) return;
    const tracks = Array.isArray(cfg.tracks) ? cfg.tracks : [];
    if (!tracks.length) {
      trackRoot.innerHTML = `<div class="track-empty"><b>The portfolio is waiting for its first drop.</b>Add your track previews to <code>assets/site-config.js</code>. Native MP3/WAV previews and SoundCloud links are supported.</div>`;
      return;
    }
    trackRoot.innerHTML = tracks.map((track,index) => {
      const title=escapeHtml(track.title || `Untitled ${index+1}`), category=escapeHtml(track.category || 'Audio'), note=escapeHtml(track.note || ''), type=track.type || 'audio';
      const url=safeExternal(track.src);
      const isNative=type==='audio' && url;
      const soundcloud=type==='soundcloud' ? toEmbed('soundcloud',url) : '';
      const spotify=type==='spotify' ? toEmbed('spotify',url) : '';
      const youtube=type==='youtube' ? toEmbed('youtube',url) : '';
      const embedded=soundcloud || spotify || youtube;
      const action=isNative ? `<button class="track-play" type="button" data-track="${index}">PLAY</button>` : embedded ? `<button class="track-play" type="button" data-embed="${index}">OPEN</button>` : `<span class="mono muted">LINK NOT SET</span>`;
      return `<article class="track-row" data-index="${index}"><span class="track-number mono">${String(index+1).padStart(2,'0')}</span><div class="track-main"><div class="track-title">${title}</div><div class="track-meta">${note}</div></div><span class="track-category">${category}</span><div class="track-action">${action}</div>${embedded ? `<div class="track-inline-player" id="track-embed-${index}" hidden><iframe class="embed-frame" src="${escapeHtml(embedded)}" title="${title} player" loading="lazy" allow="autoplay; clipboard-write; encrypted-media; fullscreen; picture-in-picture"></iframe></div>`:''}</article>`;
    }).join('');
    $$('[data-track]',trackRoot).forEach(button => button.addEventListener('click',() => {
      const track=tracks[Number(button.dataset.track)];
      if (activeButton===button) {stopActive();return;}
      stopActive();
      activeAudio=new Audio(safeExternal(track.src)); activeButton=button;
      button.textContent='STOP';button.closest('.track-row')?.classList.add('playing');
      activeAudio.play().catch(() => {button.textContent='PLAY';button.closest('.track-row')?.classList.remove('playing');activeAudio=null;activeButton=null;});
      activeAudio.addEventListener('ended',stopActive,{once:true});
    }));
    $$('[data-embed]',trackRoot).forEach(button => button.addEventListener('click',() => {
      const row=$(`#track-embed-${button.dataset.embed}`,trackRoot); if (!row) return;
      const open=row.hidden;row.hidden=!open;button.textContent=open?'CLOSE':'OPEN';
    }));
  }
  renderTracks();

  // Service cards are content-driven, with no invented rates or turnaround promises.
  const serviceRoot=$('#service-grid');
  if(serviceRoot) serviceRoot.innerHTML=(cfg.services||[]).map(service=>`<article class="service-card"><span class="service-number">${escapeHtml(service.number||'')}</span><span class="service-glyph">${escapeHtml(service.glyph||'◈')}</span><h3>${escapeHtml(service.name||'Service')}</h3><p>${escapeHtml(service.description||'')}</p></article>`).join('');

  // Product catalog comes from the server so download locations and price authority stay private.
  const CART_KEY='kal-cart-v2'; let products=[];
  function readCart(){try{const value=JSON.parse(localStorage.getItem(CART_KEY)||'{}');return value&&typeof value==='object'&&!Array.isArray(value)?value:{};}catch{return {};}}
  let cart=readCart();
  const money=(minor,currency)=>new Intl.NumberFormat('en', {style:'currency',currency:currency||'EGP',maximumFractionDigits:2}).format(Number(minor||0)/100);
  const productById=id=>products.find(product=>product.id===id);
  function saveCart(){localStorage.setItem(CART_KEY,JSON.stringify(cart));}
  function cartItems(){return Object.entries(cart).map(([id,qty])=>({product:productById(id),qty:Number(qty)})).filter(row=>row.product&&row.qty>0);}
  function cartTotal(){return cartItems().reduce((sum,row)=>sum+row.product.priceMinor*row.qty,0);}
  function renderProducts(){
    const root=$('#store-grid');if(!root)return;
    if(!products.length){root.innerHTML=`<div class="store-empty"><b>The sample vault is being stocked.</b><small>No sample packs are live yet. Add a real product, its price and private download object in the Vercel environment before it appears here. Nothing fictional is listed for sale.</small></div>`;return;}
    root.innerHTML=products.map((product,index)=>`<article class="product-card"><div class="product-art"><span class="product-index">KAL / PACK ${String(index+1).padStart(2,'0')}</span><span class="product-art-glyph">${escapeHtml(product.glyph||'◈')}</span><span class="product-format">${escapeHtml(product.format||'DIGITAL')}</span></div><div class="product-info"><h3 class="product-name">${escapeHtml(product.name)}</h3><p class="product-description">${escapeHtml(product.description||'')}</p><div class="product-tags">${(product.tags||[]).map(tag=>`<span>${escapeHtml(tag)}</span>`).join('')}</div></div><div class="product-foot"><strong class="product-price">${money(product.priceMinor,product.currency)}</strong><button class="add-button" type="button" data-add="${escapeHtml(product.id)}">ADD TO BAG +</button></div></article>`).join('');
    $$('[data-add]',root).forEach(button=>button.addEventListener('click',()=>{const id=button.dataset.add;cart[id]=Math.min(10,(Number(cart[id])||0)+1);saveCart();renderCart();button.textContent='ADDED ✓';setTimeout(()=>{if(button.isConnected)button.textContent='ADD TO BAG +';},900);}));
  }
  function renderCart(){
    const lines=$('#cart-lines'),count=$('#cart-count'),total=$('#cart-total'),checkout=$('#checkout-open');
    const rows=cartItems();const qty=rows.reduce((sum,row)=>sum+row.qty,0);if(count)count.textContent=String(qty);
    if(lines){
      if(!rows.length)lines.innerHTML='<div class="cart-empty"><b>Your bag is empty.</b>Find your next sound in the sample vault.</div>';
      else lines.innerHTML=rows.map(({product,qty})=>`<div class="cart-line"><div><div class="cart-line-title">${escapeHtml(product.name)}</div><div class="cart-line-price">${money(product.priceMinor,product.currency)} each</div></div><div class="qty-control"><button type="button" data-dec="${escapeHtml(product.id)}" aria-label="Decrease quantity">−</button><span>${qty}</span><button type="button" data-inc="${escapeHtml(product.id)}" aria-label="Increase quantity">+</button></div><button class="remove-line" type="button" data-remove="${escapeHtml(product.id)}">Remove</button></div>`).join('');
      $$('[data-dec]',lines).forEach(button=>button.addEventListener('click',()=>changeQty(button.dataset.dec,-1)));
      $$('[data-inc]',lines).forEach(button=>button.addEventListener('click',()=>changeQty(button.dataset.inc,1)));
      $$('[data-remove]',lines).forEach(button=>button.addEventListener('click',()=>{delete cart[button.dataset.remove];saveCart();renderCart();}));
    }
    const currency=rows[0]?.product.currency||'EGP';if(total)total.textContent=money(cartTotal(),currency);if(checkout)checkout.disabled=!rows.length;
  }
  function changeQty(id,delta){const next=(Number(cart[id])||0)+delta;if(next<1)delete cart[id];else cart[id]=Math.min(10,next);saveCart();renderCart();}
  async function loadCatalog(){
    try{const response=await fetch('/api/catalog',{headers:{Accept:'application/json'}});if(!response.ok)throw new Error('Catalogue endpoint not available');const data=await response.json();products=Array.isArray(data.products)?data.products:[];}
    catch(error){products=[];console.info('The store catalogue will appear after the Vercel API and product environment variables are configured.',error);}
    // Drop cart entries for products removed from the server catalogue.
    Object.keys(cart).forEach(id=>{if(!productById(id))delete cart[id];});saveCart();renderProducts();renderCart();
  }
  loadCatalog();

  // Cart and checkout drawers.
  const drawer=$('#cart-drawer'),backdrop=$('#drawer-backdrop'),checkoutBackdrop=$('#checkout-backdrop');
  function openCart(){drawer.classList.add('open');backdrop.classList.add('open');drawer.setAttribute('aria-hidden','false');document.body.style.overflow='hidden';}
  function closeCart(){drawer.classList.remove('open');backdrop.classList.remove('open');drawer.setAttribute('aria-hidden','true');document.body.style.overflow='';}
  function openCheckout(){checkoutBackdrop.classList.add('open');document.body.style.overflow='hidden';}
  function closeCheckout(){checkoutBackdrop.classList.remove('open');document.body.style.overflow=drawer.classList.contains('open')?'hidden':'';}
  $('#cart-open')?.addEventListener('click',openCart);$('#cart-close')?.addEventListener('click',closeCart);backdrop?.addEventListener('click',closeCart);
  $('#checkout-open')?.addEventListener('click',()=>{if(cartItems().length)openCheckout();});$('#checkout-close')?.addEventListener('click',closeCheckout);
  checkoutBackdrop?.addEventListener('click',event=>{if(event.target===checkoutBackdrop)closeCheckout();});
  document.addEventListener('keydown',event=>{if(event.key==='Escape'){closeCheckout();closeCart();closeMenu();}});

  // Secure checkout: the client submits IDs and quantities only; prices are recomputed server-side.
  $('#checkout-form')?.addEventListener('submit',async event=>{
    event.preventDefault();const form=event.currentTarget;const status=$('#checkout-status');const button=$('#pay-button');
    const items=cartItems().map(({product,qty})=>({id:product.id,quantity:qty}));
    if(!items.length)return;
    const customer=Object.fromEntries(new FormData(form).entries());
    status.textContent='Creating a secure checkout…';status.classList.remove('error');button.disabled=true;
    try{
      const response=await fetch('/api/checkout',{method:'POST',headers:{'Content-Type':'application/json','Accept':'application/json'},body:JSON.stringify({items,customer})});
      const data=await response.json().catch(()=>({}));if(!response.ok||!data.checkoutUrl)throw new Error(data.error||'Checkout could not be started. Check the payment setup and try again.');
      window.location.assign(data.checkoutUrl);
    }catch(error){status.textContent=error.message;status.classList.add('error');button.disabled=false;}
  });

  // Contact submissions use a server-side mail provider; there is no fake "sent" state.
  $('#contact-form')?.addEventListener('submit',async event=>{
    event.preventDefault();const form=event.currentTarget;const status=$('#contact-status');const button=$('.submit-button',form);const payload=Object.fromEntries(new FormData(form).entries());
    status.textContent='Sending your inquiry…';status.classList.remove('error');button.disabled=true;
    try{const response=await fetch('/api/contact',{method:'POST',headers:{'Content-Type':'application/json','Accept':'application/json'},body:JSON.stringify(payload)});const data=await response.json().catch(()=>({}));if(!response.ok)throw new Error(data.error||'The message could not be sent.');status.textContent='Inquiry sent. Thank you — you will hear back soon.';form.reset();}
    catch(error){status.textContent=error.message;status.classList.add('error');}
    finally{button.disabled=false;}
  });

  const copyright=$('#copyright');if(copyright)copyright.textContent=`© ${new Date().getFullYear()} KEEMZ AUDIO LAB`;
})();
