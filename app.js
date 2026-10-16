const TMDB_API_KEY = '8818385dc34c1143c1b2589f2d36f790';
mapboxgl.accessToken = 'pk.eyJ1IjoibHVxcWV5IiwiYSI6ImNtdmF4MXg3OTA4c3oyeXI0aTgzNnM5MW4ifQ.ZoG892NR3JW26wh-ZGdPRg';

// Globální proměnné a stavy
let map, timeline;
let timelineItems = new vis.DataSet([]);
let currentMarkers = [];
let currentEntity = null; // Hlavní analyzovaná entita
let isRotating = true;
let mapIdleTimer;
let activeRepertoireTab = 'directors';

// SVG ikony
const SVG_ICONS = {
    check: `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><polyline points="20 6 9 17 4 12"></polyline></svg>`,
    circle: `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"></circle></svg>`,
    pin: `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="12" y1="17" x2="12" y2="22"></line><path d="M5 17h14l-1.5-7H6.5L5 17z"></path><path d="M9 10V4h6v6"></path></svg>`,
    eye: `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path><circle cx="12" cy="12" r="3"></circle></svg>`,
    link: `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"></path><polyline points="15 3 21 3 21 9"></polyline><line x1="10" y1="14" x2="21" y2="3"></line></svg>`
};

// Struktura repertoáru z localStorage
let repertoire = JSON.parse(localStorage.getItem('cinematicRepertoirePRO_v2')) || [];

function initApp() {
    // 1. Inicializace 3D Glóbusu Mapbox
    map = new mapboxgl.Map({
        container: 'map',
        style: 'mapbox://styles/mapbox/dark-v11',
        center: [15, 45],
        zoom: 1.8,
        projection: 'globe'
    });

    // Vyvážení atmosféry zeměkoule (odstranění přesvětlené bílé aury)
    map.on('style.load', () => {
        map.setFog({
            'range': [0.5, 10],
            'color': '#050814',
            'high-color': '#0a1128',
            'space-color': '#000000',
            'horizon-blend': 0.05
        });
    });

    // Pomalá rotace při nečinnosti
    const resetIdle = () => {
        isRotating = false;
        clearTimeout(mapIdleTimer);
        mapIdleTimer = setTimeout(() => { isRotating = true; rotateGlobe(); }, 10000);
    };
    ['mousedown', 'touchstart', 'wheel', 'dragstart', 'zoomstart'].forEach(e => map.on(e, resetIdle));
    map.on('moveend', () => { if (isRotating) rotateGlobe(); });
    rotateGlobe();

    // 2. Inicializace Timeline
    timeline = new vis.Timeline(document.getElementById('timeline-container'), timelineItems, {
        start: '1970-01-01', end: '2030-01-01', height: '100%', zoomMin: 1000 * 60 * 60 * 24 * 365,
    });

    timeline.on('select', function (properties) {
        if (properties.items.length > 0) {
            const selectedId = properties.items[0];
            const item = timelineItems.get(selectedId);
            if (item && item.movieId) analyzeMovie(item.movieId);
        }
    });

    // 3. Inicializace Resizeru (posuvná delička)
    initResizer();

    renderRepertoire();
}

function rotateGlobe() {
    if (!isRotating) return;
    if (map.getZoom() < 3) {
        const center = map.getCenter();
        center.lng -= 0.08;
        map.easeTo({ center, duration: 200, easing: n => n });
    }
}

// --- POSUVNÁ DELIČKA PANELŮ ---
function initResizer() {
    const resizer = document.getElementById('resizer');
    const leftPanel = document.getElementById('visual-panel');
    const rightPanel = document.getElementById('data-panel');
    let isDragging = false;

    resizer.addEventListener('mousedown', (e) => {
        isDragging = true;
        resizer.classList.add('dragging');
        document.body.style.cursor = 'col-resize';
    });

    document.addEventListener('mousemove', (e) => {
        if (!isDragging) return;
        const containerWidth = document.getElementById('main-content').offsetWidth;
        const newRightWidth = containerWidth - e.clientX;
        if (newRightWidth > 280 && newRightWidth < containerWidth - 300) {
            rightPanel.style.width = `${newRightWidth}px`;
            if (map) map.resize();
        }
    });

    document.addEventListener('mouseup', () => {
        if (isDragging) {
            isDragging = false;
            resizer.classList.remove('dragging');
            document.body.style.cursor = 'default';
            if (map) map.resize();
        }
    });
}

// --- PŘEPÍNÁNÍ POHLEDŮ ---
function switchView(view) {
    document.querySelectorAll('.view-toggles button').forEach(b => b.classList.remove('active'));
    document.getElementById(`btn-${view}`).classList.add('active');
    
    document.getElementById('map').style.display = 'none';
    document.getElementById('timeline-view').style.display = 'none';

    document.getElementById(view === 'map' ? 'map' : `${view}-view`).style.display = 'block';
    
    if (view === 'map' && map) map.resize();
    if (view === 'timeline' && timeline) timeline.redraw();
}

// --- VYHLEDÁVÁNÍ ---
function handleEnter(e) { if (e.key === 'Enter') searchAction(); }

async function searchAction() {
    const query = document.getElementById('searchInput').value.trim();
    if (!query) return;

    closeSubInspector();
    const resDiv = document.getElementById('results-content');
    resDiv.innerHTML = `<p class="neon-text">Vyhledávám v databázi...</p>`;
    document.getElementById('entity-profile').style.display = 'none';
    document.getElementById('filmography-section').style.display = 'none';
    document.getElementById('creators-section').style.display = 'none';

    try {
        const res = await fetch(`https://api.themoviedb.org/3/search/multi?api_key=${TMDB_API_KEY}&query=${encodeURIComponent(query)}`);
        const data = await res.json();
        
        const filtered = data.results.filter(r => r.media_type === 'person' || r.media_type === 'movie' || r.media_type === 'tv').slice(0, 5);
        if (filtered.length > 0) {
            resDiv.innerHTML = '';
            filtered.forEach(item => {
                const title = item.title || item.name;
                let typeLabel = '🎬 Film';
                if (item.media_type === 'person') typeLabel = '👤 Osoba';
                if (item.media_type === 'tv') typeLabel = '📺 Seriál';
                
                const div = document.createElement('div');
                div.className = 'film-item';
                div.innerHTML = `
                    <div class="film-info"><strong class="neon-text">${title}</strong> <span style="font-size:10px;color:#666;">(${typeLabel})</span></div>
                `;
                const btn = document.createElement('button');
                btn.className = 'action-btn';
                btn.textContent = 'Analyzovat';
                btn.addEventListener('click', () => {
                    if (item.media_type === 'person') analyzePerson(item.id);
                    else analyzeMovie(item.id, item.media_type === 'tv' ? 'tv' : 'movie');
                });
                div.appendChild(btn);
                resDiv.appendChild(div);
            });
        } else { resDiv.innerHTML = `<p>Žádné výsledky nenalezeny.</p>`; }
    } catch (err) { resDiv.innerHTML = `<p style="color:red;">Chyba připojení.</p>`; }
}

// --- ANALÝZA OSOBY (Režisér, Herec, Kamera...) ---
async function analyzePerson(id) {
    document.getElementById('results-content').innerHTML = '';
    clearVisuals();
    closeSubInspector();
    
    const detRes = await fetch(`https://api.themoviedb.org/3/person/${id}?api_key=${TMDB_API_KEY}`);
    const person = await detRes.json();
    
    const credRes = await fetch(`https://api.themoviedb.org/3/person/${id}/movie_credits?api_key=${TMDB_API_KEY}`);
    const credits = await credRes.json();

    let works = [];
    if (person.known_for_department === 'Acting') { works = credits.cast; } 
    else { works = credits.crew.filter(c => c.department === person.known_for_department); }
    
    works = Array.from(new Map(works.filter(w => w.release_date).map(item => [item.id, item])).values())
            .sort((a, b) => new Date(a.release_date) - new Date(b.release_date));

    currentEntity = { type: 'person', id: person.id, name: person.name, job: person.known_for_department, works: works };

    // Automaticky přepneme záložku repertoáru podle profese
    autoSwitchRepertoireTab(person.known_for_department);

    document.getElementById('creators-section').style.display = 'none';
    renderPersonProfile(person, works.length);
    renderFilmographyList(works);
    populateTimeline(works, person.name);
    
    if (person.place_of_birth) geocodeAndZoom(person.place_of_birth, person.name);
    switchView('map');
}

function renderPersonProfile(person, totalFilms) {
    document.getElementById('entity-profile').style.display = 'block';
    document.getElementById('entity-name').innerText = person.name;
    
    const imgEl = document.getElementById('entity-photo');
    imgEl.src = person.profile_path ? `https://image.tmdb.org/t/p/w200${person.profile_path}` : 'data:image/gif;base64,R0lGODlhAQABAAD/ACwAAAAAAQABAAACADs=';
    
    let detailsHtml = '';
    if (person.known_for_department) detailsHtml += `<div><span class="label">Profese:</span> ${person.known_for_department}</div>`;
    if (person.birthday) detailsHtml += `<div><span class="label">Narození:</span> ${person.birthday}</div>`;
    if (person.deathday) detailsHtml += `<div><span class="label">Úmrtí:</span> ${person.deathday}</div>`;
    if (person.place_of_birth) detailsHtml += `<div><span class="label">Místo:</span> <span class="interactive-link" onclick="geocodeAndZoom('${person.place_of_birth.replace(/'/g, "\\'")}', '${person.name.replace(/'/g, "\\'")}')">${person.place_of_birth}</span></div>`;
    if (totalFilms > 0) detailsHtml += `<div><span class="label">Celkem děl:</span> ${totalFilms}</div>`;
    
    document.getElementById('entity-details').innerHTML = detailsHtml;
    document.getElementById('entity-bio').innerText = person.biography || '';
    
    const cat = getCategoryFromDepartment(person.known_for_department);
    const existing = repertoire.find(r => r.id === person.id && r.category === cat);
    
    const actBtn = document.createElement('button');
    actBtn.className = `btn-icon ${existing ? 'active-pinned' : ''}`;
    actBtn.style.width = 'auto';
    actBtn.style.padding = '0 8px';
    actBtn.style.fontSize = '10px';
    actBtn.innerHTML = `${SVG_ICONS.pin} <span style="margin-left:4px;">${existing ? 'V repertoáru' : 'Přidat do repertoáru'}</span>`;
    actBtn.onclick = () => forceAddToRepertoire();

    document.getElementById('entity-actions').innerHTML = '';
    document.getElementById('entity-actions').appendChild(actBtn);
}

// --- ANALÝZA FILMU / SERIÁLU ---
async function analyzeMovie(id, mediaType = 'movie') {
    document.getElementById('results-content').innerHTML = '';
    clearVisuals();
    closeSubInspector();
    
    const endpoint = mediaType === 'tv' ? 'tv' : 'movie';
    const detRes = await fetch(`https://api.themoviedb.org/3/${endpoint}/${id}?api_key=${TMDB_API_KEY}`);
    const movie = await detRes.json();
    
    const credRes = await fetch(`https://api.themoviedb.org/3/${endpoint}/${id}/credits?api_key=${TMDB_API_KEY}`);
    const credits = await credRes.json();

    currentEntity = { type: mediaType, id: movie.id, title: movie.title || movie.name };

    // Přepnutí repertoáru na záložku filmů/seriálů
    setRepertoireTab(mediaType === 'tv' ? 'series' : 'movies');

    document.getElementById('filmography-section').style.display = 'none';
    renderMovieProfile(movie, mediaType);
    renderCreatorsBreakdown(credits);
    
    if (movie.production_countries && movie.production_countries.length > 0) {
        movie.production_countries.forEach(c => geocodeAndAddMarker(c.name, movie.title || movie.name));
    }

    const releaseDate = movie.release_date || movie.first_air_date;
    if (releaseDate) {
        timelineItems.add({ id: 'current_movie', content: movie.title || movie.name, start: releaseDate, className: 'film-node' });
        timeline.fit();
    }
    
    switchView('map');
}

function renderMovieProfile(movie, mediaType) {
    document.getElementById('entity-profile').style.display = 'block';
    document.getElementById('entity-name').innerText = movie.title || movie.name;
    
    const imgEl = document.getElementById('entity-photo');
    imgEl.src = movie.poster_path ? `https://image.tmdb.org/t/p/w200${movie.poster_path}` : 'data:image/gif;base64,R0lGODlhAQABAAD/ACwAAAAAAQABAAACADs=';
    
    const releaseDate = movie.release_date || movie.first_air_date || '';
    const year = releaseDate ? releaseDate.split('-')[0] : '';
    const genres = movie.genres ? movie.genres.map(g => g.name).join(', ') : '';
    const runtime = movie.runtime || (movie.episode_run_time ? movie.episode_run_time[0] : null);
    
    let detailsHtml = `<div><span class="label">Rok:</span> <span class="interactive-link" onclick="jumpToYear('${releaseDate}')">${year}</span></div>`;
    if (runtime) detailsHtml += `<div><span class="label">Stopáž:</span> ${runtime} min</div>`;
    if (genres) detailsHtml += `<div><span class="label">Žánry:</span> ${genres}</div>`;
    
    document.getElementById('entity-details').innerHTML = detailsHtml;
    document.getElementById('entity-bio').innerText = movie.overview || '';
    
    const cat = mediaType === 'tv' ? 'series' : 'movies';
    const existing = repertoire.find(r => r.id === movie.id && r.category === cat);
    
    const actionsDiv = document.getElementById('entity-actions');
    actionsDiv.innerHTML = '';

    if (movie.imdb_id) {
        const imdbA = document.createElement('a');
        imdbA.href = `https://www.imdb.com/title/${movie.imdb_id}`;
        imdbA.target = '_blank';
        imdbA.className = 'btn-icon imdb-link';
        imdbA.innerHTML = SVG_ICONS.link;
        imdbA.title = 'IMDb Link';
        actionsDiv.appendChild(imdbA);
    }

    const repBtn = document.createElement('button');
    repBtn.className = `btn-icon ${existing ? 'active-pinned' : ''}`;
    repBtn.style.width = 'auto';
    repBtn.style.padding = '0 8px';
    repBtn.style.fontSize = '10px';
    repBtn.innerHTML = `${SVG_ICONS.pin} <span style="margin-left:4px;">${existing ? 'V repertoáru' : 'Přidat'}</span>`;
    repBtn.onclick = () => forceAddToRepertoire();
    actionsDiv.appendChild(repBtn);
}

// --- ZOBRAZENÍ TVŮRCŮ (Místo Node Mapy) ---
function renderCreatorsBreakdown(credits) {
    const section = document.getElementById('creators-section');
    const container = document.getElementById('creators-breakdown');
    section.style.display = 'block';
    container.innerHTML = '';

    const rolesMap = [
        { title: 'Režie', crew: credits.crew.filter(c => c.job === 'Director') },
        { title: 'Scénář', crew: credits.crew.filter(c => c.department === 'Writing') },
        { title: 'Kamera', crew: credits.crew.filter(c => c.department === 'Camera') },
        { title: 'Hudba', crew: credits.crew.filter(c => c.department === 'Sound' || c.job === 'Original Music Composer') },
        { title: 'Střih', crew: credits.crew.filter(c => c.department === 'Editing') },
        { title: 'Obsazení (Herci)', crew: credits.cast.slice(0, 6) }
    ];

    rolesMap.forEach(group => {
        if (group.crew && group.crew.length > 0) {
            const groupDiv = document.createElement('div');
            groupDiv.className = 'creator-group';
            
            const titleDiv = document.createElement('div');
            titleDiv.className = 'creator-role-title';
            titleDiv.innerText = group.title;
            
            const namesDiv = document.createElement('div');
            namesDiv.className = 'creator-names';
            
            // Unikátní lidé
            const uniqueCrew = Array.from(new Map(group.crew.map(c => [c.id, c])).values());
            
            uniqueCrew.forEach(person => {
                const tag = document.createElement('span');
                tag.className = 'creator-tag';
                tag.innerText = person.name;
                tag.onclick = () => openSubInspectorPerson(person.id, currentEntity.id);
                namesDiv.appendChild(tag);
            });

            groupDiv.appendChild(titleDiv);
            groupDiv.appendChild(namesDiv);
            container.appendChild(groupDiv);
        }
    });
}

// --- PODVYHLEDÁVÁNÍ V LEVÉM PANELU ---
async function openSubInspectorPerson(personId, highlightMovieId) {
    const subPanel = document.getElementById('sub-inspector-panel');
    const container = document.getElementById('sub-panel-content');
    subPanel.style.display = 'block';
    container.innerHTML = `<p class="neon-text">Načítám detail tvůrce...</p>`;

    try {
        const personRes = await fetch(`https://api.themoviedb.org/3/person/${personId}?api_key=${TMDB_API_KEY}`);
        const person = await personRes.json();

        const credRes = await fetch(`https://api.themoviedb.org/3/person/${personId}/movie_credits?api_key=${TMDB_API_KEY}`);
        const credits = await credRes.json();

        let works = credits.crew.length > 0 ? credits.crew : credits.cast;
        works = Array.from(new Map(works.filter(w => w.release_date).map(item => [item.id, item])).values())
                .sort((a, b) => new Date(a.release_date) - new Date(b.release_date));

        let html = `
            <div style="display:flex; gap:15px; margin-bottom:15px;">
                <img src="${person.profile_path ? 'https://image.tmdb.org/t/p/w200' + person.profile_path : ''}" style="width:80px; height:120px; object-fit:cover; border:1px solid var(--neon-blue);">
                <div>
                    <h4 class="neon-text" style="margin:0 0 5px 0;">${person.name}</h4>
                    <div style="font-size:10px; color:var(--neon-orange);">${person.known_for_department || ''}</div>
                    <div style="font-size:11px; color:#aaa; margin-top:5px;">Narozen: ${person.birthday || 'Neznámo'}</div>
                    <button class="action-btn" style="margin-top:8px; padding:3px 8px; font-size:10px;" onclick="analyzePerson(${person.id})">Plná analýza ➔</button>
                </div>
            </div>
            <h4 style="color:var(--neon-orange); border-bottom:1px solid #333; padding-bottom:4px; font-size:12px;">Filmografie (Aktivní zvýraznění)</h4>
            <div class="list-container">
        `;

        works.forEach(w => {
            const isHighlighted = w.id === highlightMovieId;
            const year = w.release_date ? w.release_date.split('-')[0] : '????';
            html += `
                <div class="film-item ${isHighlighted ? 'highlighted-film' : ''}">
                    <div class="film-info">
                        <span class="film-year">${year}</span>
                        <span class="film-title" onclick="analyzeMovie(${w.id})">${w.title} ${isHighlighted ? '◀ (Aktivní)' : ''}</span>
                    </div>
                </div>
            `;
        });

        html += `</div>`;
        container.innerHTML = html;

    } catch (e) {
        container.innerHTML = `<p style="color:red;">Chyba načítání detailu.</p>`;
    }
}

function closeSubInspector() {
    document.getElementById('sub-inspector-panel').style.display = 'none';
}

// --- VÝPIS FILMOGRAFIE OSOBY ---
function renderFilmographyList(works) {
    const listDiv = document.getElementById('filmography-list');
    document.getElementById('filmography-section').style.display = 'block';
    listDiv.innerHTML = '';
    
    const cat = getCategoryFromDepartment(currentEntity.job);
    const repData = repertoire.find(r => r.id === currentEntity.id && r.category === cat);
    const seenArray = repData ? repData.seen : [];
    const wishArray = repData ? (repData.wish || []) : [];

    works.forEach(m => {
        const year = m.release_date ? m.release_date.split('-')[0] : '????';
        const isSeen = seenArray.includes(m.id);
        const isWish = wishArray.includes(m.id);

        const div = document.createElement('div');
        div.className = 'film-item';

        const infoDiv = document.createElement('div');
        infoDiv.className = 'film-info';
        
        const yearSpan = document.createElement('span');
        yearSpan.className = 'film-year';
        yearSpan.textContent = year;
        yearSpan.onclick = () => jumpToYear(m.release_date);

        const titleSpan = document.createElement('span');
        titleSpan.className = 'film-title';
        titleSpan.textContent = m.title;
        titleSpan.onclick = () => analyzeMovie(m.id);

        infoDiv.appendChild(yearSpan);
        infoDiv.appendChild(titleSpan);

        const actionsDiv = document.createElement('div');
        actionsDiv.className = 'film-actions';

        const seenBtn = document.createElement('button');
        seenBtn.className = `btn-icon ${isSeen ? 'active-seen' : ''}`;
        seenBtn.innerHTML = SVG_ICONS.check;
        seenBtn.title = 'Viděno';
        seenBtn.onclick = () => toggleFilmStatus(m.id, 'seen');

        const wishBtn = document.createElement('button');
        wishBtn.className = `btn-icon ${isWish && !isSeen ? 'active-wish' : ''}`;
        wishBtn.innerHTML = SVG_ICONS.circle;
        wishBtn.title = 'Chci vidět';
        wishBtn.onclick = () => toggleFilmStatus(m.id, 'wish');

        actionsDiv.appendChild(seenBtn);
        actionsDiv.appendChild(wishBtn);

        div.appendChild(infoDiv);
        div.appendChild(actionsDiv);
        listDiv.appendChild(div);
    });
}

// --- SPRAVA REPERTOÁRU & TABS ---
function setRepertoireTab(cat) {
    activeRepertoireTab = cat;
    document.querySelectorAll('.rep-tab-btn').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.cat === cat);
    });
    renderRepertoire();
}

function autoSwitchRepertoireTab(department) {
    const cat = getCategoryFromDepartment(department);
    setRepertoireTab(cat);
}

function getCategoryFromDepartment(dept) {
    if (!dept) return 'directors';
    const d = dept.toLowerCase();
    if (d.includes('direct')) return 'directors';
    if (d.includes('writ')) return 'writers';
    if (d.includes('camera') || d.includes('photo')) return 'cinematographers';
    if (d.includes('sound') || d.includes('music')) return 'musicians';
    if (d.includes('edit')) return 'editors';
    if (d.includes('act')) return 'actors';
    return 'directors';
}

function toggleFilmStatus(filmId, type) {
    if (!currentEntity || currentEntity.type !== 'person') return;
    
    const cat = getCategoryFromDepartment(currentEntity.job);
    let repItem = repertoire.find(r => r.id === currentEntity.id && r.category === cat);
    
    if (!repItem) {
        repItem = { id: currentEntity.id, name: currentEntity.name, category: cat, total: currentEntity.works.length, seen: [], wish: [], pinned: false, hidden: false };
        repertoire.push(repItem);
    } else {
        repItem.total = currentEntity.works.length;
    }

    if (type === 'seen') {
        if (repItem.seen.includes(filmId)) repItem.seen = repItem.seen.filter(id => id !== filmId);
        else { repItem.seen.push(filmId); repItem.wish = (repItem.wish || []).filter(id => id !== filmId); }
    } else if (type === 'wish') {
        if (!repItem.wish) repItem.wish = [];
        if (repItem.wish.includes(filmId)) repItem.wish = repItem.wish.filter(id => id !== filmId);
        else { repItem.wish.push(filmId); repItem.seen = repItem.seen.filter(id => id !== filmId); }
    }

    saveRepertoire();
    renderFilmographyList(currentEntity.works);
}

function forceAddToRepertoire() {
    if (!currentEntity) return;

    if (currentEntity.type === 'person') {
        const cat = getCategoryFromDepartment(currentEntity.job);
        if (!repertoire.find(r => r.id === currentEntity.id && r.category === cat)) {
            repertoire.push({ id: currentEntity.id, name: currentEntity.name, category: cat, total: currentEntity.works.length, seen: [], wish: [], pinned: false, hidden: false });
            saveRepertoire();
            renderPersonProfile(currentEntity, currentEntity.works.length);
        }
    } else {
        const cat = currentEntity.type === 'tv' ? 'series' : 'movies';
        if (!repertoire.find(r => r.id === currentEntity.id && r.category === cat)) {
            repertoire.push({ id: currentEntity.id, name: currentEntity.title, category: cat, total: 1, seen: [currentEntity.id], wish: [], pinned: false, hidden: false });
            saveRepertoire();
            renderMovieProfile(currentEntity, currentEntity.type);
        }
    }
}

function toggleRepertoireAttr(id, cat, attr) {
    const item = repertoire.find(r => r.id === id && r.category === cat);
    if (item) {
        item[attr] = !item[attr];
        saveRepertoire();
    }
}

function saveRepertoire() {
    localStorage.setItem('cinematicRepertoirePRO_v2', JSON.stringify(repertoire));
    renderRepertoire();
}

// Výpočet přechodu barev: Tmavě fialová -> Oranžová -> Zelená
function calculateScoreColor(seen, total) {
    if (total === 0) return '#4c1d95'; // Tmavě fialová pro 0%
    const ratio = Math.min(seen / total, 1);
    
    if (ratio < 0.5) {
        // Interpolace od fialové (76, 29, 149) k oranžové (255, 102, 0)
        const t = ratio / 0.5;
        const r = Math.round(76 + (255 - 76) * t);
        const g = Math.round(29 + (102 - 29) * t);
        const b = Math.round(149 - 149 * t);
        return `rgb(${r}, ${g}, ${b})`;
    } else {
        // Interpolace od oranžové (255, 102, 0) k zelené (0, 230, 118)
        const t = (ratio - 0.5) / 0.5;
        const r = Math.round(255 - 255 * t);
        const g = Math.round(102 + (230 - 102) * t);
        const b = Math.round(0 + 118 * t);
        return `rgb(${r}, ${g}, ${b})`;
    }
}

function renderRepertoire() {
    const listDiv = document.getElementById('repertoire-list');
    listDiv.innerHTML = '';
    
    const visibility = document.getElementById('filter-visibility').value;
    const sortOrder = document.getElementById('filter-sort').value;

    let filtered = repertoire.filter(item => {
        if (item.category !== activeRepertoireTab) return false;
        if (visibility === 'main') return !item.hidden;
        if (visibility === 'hidden') return item.hidden;
        return true;
    });

    filtered.sort((a, b) => {
        if (a.pinned !== b.pinned) return b.pinned ? 1 : -1;
        if (sortOrder === 'alpha') return a.name.localeCompare(b.name);
        const scoreA = a.total > 0 ? (a.seen.length / a.total) : 0;
        const scoreB = b.total > 0 ? (b.seen.length / b.total) : 0;
        return sortOrder === 'desc' ? scoreB - scoreA : scoreA - scoreB;
    });

    if (filtered.length === 0) {
        listDiv.innerHTML = `<p style="font-size:11px; color:#555; text-align:center; margin-top:15px;">Žádný položky v této záložce.</p>`;
        return;
    }

    filtered.forEach(item => {
        const isMedia = item.category === 'movies' || item.category === 'series';
        const color = calculateScoreColor(item.seen.length, item.total);
        
        const div = document.createElement('div');
        div.className = `repertoire-item ${item.pinned ? 'pinned' : ''} ${item.hidden ? 'hidden-item' : ''}`;
        div.style.borderLeftColor = isMedia ? 'var(--neon-blue)' : color;
        
        const infoDiv = document.createElement('div');
        infoDiv.className = 'rep-info';
        infoDiv.onclick = () => {
            if (isMedia) analyzeMovie(item.id, item.category === 'series' ? 'tv' : 'movie');
            else analyzePerson(item.id);
        };

        const scoreText = isMedia ? '' : `<span class="rep-score" style="color:${color}">${item.seen.length} / ${item.total}</span>`;
        infoDiv.innerHTML = `<span class="rep-name">${item.name}</span>${scoreText}`;

        const actionsDiv = document.createElement('div');
        actionsDiv.className = 'rep-actions';

        const pinBtn = document.createElement('button');
        pinBtn.className = `btn-icon ${item.pinned ? 'active-pinned' : ''}`;
        pinBtn.innerHTML = SVG_ICONS.pin;
        pinBtn.title = 'Pinnout nahoru';
        pinBtn.onclick = (e) => { e.stopPropagation(); toggleRepertoireAttr(item.id, item.category, 'pinned'); };

        const hideBtn = document.createElement('button');
        hideBtn.className = 'btn-icon';
        hideBtn.innerHTML = SVG_ICONS.eye;
        hideBtn.title = 'Skrýt';
        hideBtn.onclick = (e) => { e.stopPropagation(); toggleRepertoireAttr(item.id, item.category, 'hidden'); };

        actionsDiv.appendChild(pinBtn);
        actionsDiv.appendChild(hideBtn);

        div.appendChild(infoDiv);
        div.appendChild(actionsDiv);
        listDiv.appendChild(div);
    });
}

// --- POMOCNÉ FUNKCE (Mapa, Timeline) ---
function clearVisuals() {
    currentMarkers.forEach(m => m.remove());
    currentMarkers = [];
    timelineItems.clear();
}

function jumpToYear(dateString) {
    if (!dateString) return;
    switchView('timeline');
    const targetDate = new Date(dateString);
    timeline.setWindow(
        new Date(targetDate.getFullYear() - 2, 0, 1),
        new Date(targetDate.getFullYear() + 2, 0, 1)
    );
}

function populateTimeline(works, groupName) {
    works.forEach((m, idx) => {
        if (m.release_date) {
            timelineItems.add({ id: idx, movieId: m.id, content: m.title, start: m.release_date, className: 'film-node' });
        }
    });
    timeline.fit();
}

async function geocodeAndZoom(locationString, title) {
    try {
        const res = await fetch(`https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(locationString)}.json?access_token=${mapboxgl.accessToken}`);
        const data = await res.json();
        if (data.features && data.features.length > 0) {
            const center = data.features[0].center;
            switchView('map');
            
            // Odstranění starých markerů a přidání nového špendlíku
            currentMarkers.forEach(m => m.remove());
            currentMarkers = [];

            const el = document.createElement('div');
            el.className = 'custom-marker';
            const popup = new mapboxgl.Popup({ offset: 12 }).setHTML(`<div style="color:var(--neon-orange);font-weight:bold;font-size:11px;">${title}</div><div style="font-size:10px;color:#aaa;">${locationString}</div>`);
            const marker = new mapboxgl.Marker(el).setLngLat(center).setPopup(popup).addTo(map);
            currentMarkers.push(marker);

            map.flyTo({ center: center, zoom: 5, essential: true });
        }
    } catch (e) { console.error("Geocoding selhal."); }
}

async function geocodeAndAddMarker(locationString, movieTitle) {
    try {
        const res = await fetch(`https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(locationString)}.json?access_token=${mapboxgl.accessToken}`);
        const data = await res.json();
        if (data.features && data.features.length > 0) {
            const lng = data.features[0].center[0];
            const lat = data.features[0].center[1];
            
            const el = document.createElement('div');
            el.className = 'custom-marker';
            const popup = new mapboxgl.Popup({ offset: 12 }).setHTML(`<div style="color:var(--neon-orange);font-weight:bold;font-size:11px;">Místo natáčení / Produkce: ${locationString}</div><div style="font-size:10px;color:#ccc;">🎬 ${movieTitle}</div>`);
            const marker = new mapboxgl.Marker(el).setLngLat([lng, lat]).setPopup(popup).addTo(map);
            currentMarkers.push(marker);
        }
    } catch (e) {}
}

window.onload = initApp;
