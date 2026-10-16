const TMDB_API_KEY = '8818385dc34c1143c1b2589f2d36f790';
mapboxgl.accessToken = 'pk.eyJ1IjoibHVxcWV5IiwiYSI6ImNtdmF4MXg3OTA4c3oyeXI0aTgzNnM5MW4ifQ.ZoG892NR3JW26wh-ZGdPRg';

// Global Variables
let map, timeline;
let timelineItems = new vis.DataSet([]);
let currentMarkers = [];
let currentEntity = null;
let isRotating = true;
let mapIdleTimer;
let activeRepertoireTab = 'directors';
let filmographySortOrder = 'desc';
let showUpcoming = false;
let isWishlistDrawerOpen = false;

// Dynamic Tab Sorting State
let tabSortMode = localStorage.getItem('cinematicTabSortMode') || 'recent';
let categoryMeta = JSON.parse(localStorage.getItem('cinematicCategoryMeta')) || {
    directors: { lastAdded: 8 },
    writers: { lastAdded: 7 },
    cinematographers: { lastAdded: 6 },
    musicians: { lastAdded: 5 },
    editors: { lastAdded: 4 },
    actors: { lastAdded: 3 },
    movies: { lastAdded: 2 },
    series: { lastAdded: 1 }
};

const REPERTOIRE_CATEGORIES = ['directors', 'writers', 'cinematographers', 'musicians', 'editors', 'actors', 'movies', 'series'];

// SVG Icons
const SVG_ICONS = {
    check: `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><polyline points="20 6 9 17 4 12"></polyline></svg>`,
    circle: `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"></circle></svg>`,
    bookmark: `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"></path></svg>`,
    pin: `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="12" y1="17" x2="12" y2="22"></line><path d="M5 17h14l-1.5-7H6.5L5 17z"></path><path d="M9 10V4h6v6"></path></svg>`,
    eye: `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path><circle cx="12" cy="12" r="3"></circle></svg>`,
    link: `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"></path><polyline points="15 3 21 3 21 9"></polyline><line x1="10" y1="14" x2="21" y2="3"></line></svg>`
};

// Repertoire storage
let repertoire = JSON.parse(localStorage.getItem('cinematicRepertoirePRO_v9')) || [];

function initApp() {
    // 1. Initialize Mapbox Globe
    map = new mapboxgl.Map({
        container: 'map',
        style: 'mapbox://styles/mapbox/dark-v11',
        center: [15, 45],
        zoom: 1.8,
        projection: 'globe'
    });

    map.on('style.load', () => {
        updateGlobeGlow(50);
    });

    // Idle rotation logic
    const resetIdle = () => {
        isRotating = false;
        clearTimeout(mapIdleTimer);
        mapIdleTimer = setTimeout(() => { isRotating = true; rotateGlobe(); }, 10000);
    };
    ['mousedown', 'touchstart', 'wheel', 'dragstart', 'zoomstart'].forEach(e => map.on(e, resetIdle));
    map.on('moveend', () => { if (isRotating) rotateGlobe(); });
    rotateGlobe();

    // 2. Initialize Vis-Timeline
    timeline = new vis.Timeline(document.getElementById('timeline-container'), timelineItems, {
        start: '1970-01-01',
        end: '2030-01-01',
        height: '100%',
        zoomMin: 1000 * 60 * 60 * 24 * 365,
        margin: { item: 6, axis: 12 },
        stack: true,
        tooltip: { followMouse: true, overflowMethod: 'cap' }
    });

    timeline.on('select', function (properties) {
        if (properties.items.length > 0) {
            const selectedId = properties.items[0];
            const item = timelineItems.get(selectedId);
            if (item && item.movieId) analyzeMovie(item.movieId);
        }
    });

    const tabSortSelect = document.getElementById('filter-tab-sort');
    if (tabSortSelect) tabSortSelect.value = tabSortMode;

    initResizers();
    initTabsScroll();

    renderTabs();
    renderRepertoire();
    renderWishlistDrawer();
}

// --- DYNAMIC GLOBE ATMOSPHERE GLOW CONTROL ---
function updateGlobeGlow(val) {
    if (!map) return;
    const factor = val / 100;
    
    map.setFog({
        'range': [0.5, 10],
        'color': `rgba(0, 0, 0, ${1 - factor * 0.5})`,
        'high-color': `rgba(255, 255, 255, ${factor * 0.95})`,
        'space-color': factor > 0 
            ? `rgba(${Math.round(10 * factor)}, ${Math.round(20 * factor)}, ${Math.round(45 * factor)}, 1)` 
            : '#000000',
        'horizon-blend': 0.01 + 0.09 * factor
    });
}

function rotateGlobe() {
    if (!isRotating) return;
    if (map.getZoom() < 3) {
        const center = map.getCenter();
        center.lng -= 0.08;
        map.easeTo({ center, duration: 200, easing: n => n });
    }
}

// --- DRAGGABLE RESIZERS ---
function initResizers() {
    const resizerV = document.getElementById('resizer');
    const rightPanel = document.getElementById('data-panel');
    let isDraggingV = false;

    resizerV.addEventListener('mousedown', () => {
        isDraggingV = true;
        resizerV.classList.add('dragging');
        document.body.style.cursor = 'col-resize';
    });

    const resizerH = document.getElementById('resizer-h');
    const repSection = document.getElementById('repertoire-section');
    let isDraggingH = false;

    resizerH.addEventListener('mousedown', () => {
        isDraggingH = true;
        resizerH.classList.add('dragging');
        document.body.style.cursor = 'row-resize';
    });

    document.addEventListener('mousemove', (e) => {
        if (isDraggingV) {
            const containerWidth = document.getElementById('main-content').offsetWidth;
            const newRightWidth = containerWidth - e.clientX;
            if (newRightWidth > 150 && newRightWidth < containerWidth - 100) {
                rightPanel.style.width = `${newRightWidth}px`;
                if (map) map.resize();
            }
        }
        if (isDraggingH) {
            const panelRect = rightPanel.getBoundingClientRect();
            const newRepHeight = panelRect.bottom - e.clientY;
            if (newRepHeight > 100 && newRepHeight < panelRect.height - 100) {
                repSection.style.height = `${newRepHeight}px`;
            }
        }
    });

    document.addEventListener('mouseup', () => {
        if (isDraggingV) {
            isDraggingV = false;
            resizerV.classList.remove('dragging');
            document.body.style.cursor = 'default';
            if (map) map.resize();
        }
        if (isDraggingH) {
            isDraggingH = false;
            resizerH.classList.remove('dragging');
            document.body.style.cursor = 'default';
        }
    });
}

// --- REPERTOIRE TABS & SMOOTH WHEEL SCROLL FIX ---
function touchCategory(cat) {
    if (!categoryMeta[cat]) categoryMeta[cat] = {};
    categoryMeta[cat].lastAdded = Date.now();
    localStorage.setItem('cinematicCategoryMeta', JSON.stringify(categoryMeta));
    renderTabs();
}

function changeTabSortMode(mode) {
    tabSortMode = mode;
    localStorage.setItem('cinematicTabSortMode', mode);
    renderTabs();
}

function renderTabs() {
    const tabsContainer = document.getElementById('rep-tabs');
    if (!tabsContainer) return;

    let categories = [...REPERTOIRE_CATEGORIES];

    if (tabSortMode === 'recent') {
        categories.sort((a, b) => {
            const timeA = categoryMeta[a]?.lastAdded || 0;
            const timeB = categoryMeta[b]?.lastAdded || 0;
            return timeB - timeA;
        });
    } else if (tabSortMode === 'count') {
        categories.sort((a, b) => {
            const countA = repertoire.filter(r => r.category === a).length;
            const countB = repertoire.filter(r => r.category === b).length;
            return countB - countA;
        });
    }

    const labelMap = {
        directors: 'DIRECTING',
        writers: 'SCREENPLAY',
        cinematographers: 'CAMERA',
        musicians: 'MUSIC',
        editors: 'EDITING',
        actors: 'ACTING',
        movies: 'MOVIES',
        series: 'SERIES'
    };

    tabsContainer.innerHTML = '';
    categories.forEach(cat => {
        const count = repertoire.filter(r => r.category === cat).length;
        const btn = document.createElement('button');
        btn.className = `rep-tab-btn ${cat === activeRepertoireTab ? 'active' : ''}`;
        btn.dataset.cat = cat;
        btn.innerHTML = `<span>${labelMap[cat] || cat.toUpperCase()}</span> ${count > 0 ? `<span class="tab-count">(${count})</span>` : ''}`;
        btn.onclick = () => setRepertoireTab(cat);
        tabsContainer.appendChild(btn);
    });
}

function initTabsScroll() {
    const tabsContainer = document.getElementById('rep-tabs');
    if (!tabsContainer) return;

    tabsContainer.addEventListener('wheel', (e) => {
        if (e.deltaY !== 0) {
            e.preventDefault();
            tabsContainer.scrollLeft += e.deltaY;
        }
    }, { passive: false });
}

// --- VIEW SWITCHER ---
function switchView(view) {
    document.querySelectorAll('.view-toggles button').forEach(b => b.classList.remove('active'));
    document.getElementById(`btn-${view}`).classList.add('active');
    
    document.getElementById('map').style.display = 'none';
    document.getElementById('timeline-view').style.display = 'none';

    document.getElementById(view === 'map' ? 'map' : `${view}-view`).style.display = 'block';
    
    if (view === 'map' && map) map.resize();
    if (view === 'timeline' && timeline) timeline.redraw();
}

// --- SEARCH ACTION ---
function handleEnter(e) { if (e.key === 'Enter') searchAction(); }

async function searchAction() {
    const query = document.getElementById('searchInput').value.trim();
    if (!query) return;

    closeSubInspector();
    const resDiv = document.getElementById('results-content');
    resDiv.innerHTML = `<p class="neon-text">SEARCHING DATABASE...</p>`;
    document.getElementById('entity-profile').style.display = 'none';
    document.getElementById('filmography-section').style.display = 'none';
    document.getElementById('creators-section').style.display = 'none';
    document.getElementById('financials-section').style.display = 'none';

    try {
        const res = await fetch(`https://api.themoviedb.org/3/search/multi?api_key=${TMDB_API_KEY}&query=${encodeURIComponent(query)}`);
        const data = await res.json();
        
        const filtered = data.results.filter(r => r.media_type === 'person' || r.media_type === 'movie' || r.media_type === 'tv').slice(0, 5);
        if (filtered.length > 0) {
            resDiv.innerHTML = '';
            filtered.forEach(item => {
                const title = item.title || item.name;
                let typeLabel = 'MOVIE';
                if (item.media_type === 'person') typeLabel = 'CREATOR';
                if (item.media_type === 'tv') typeLabel = 'SERIES';
                
                const div = document.createElement('div');
                div.className = 'film-item';
                div.innerHTML = `
                    <div class="film-info"><strong class="neon-text">${title}</strong> <span style="font-size:10px;color:#64748b;">(${typeLabel})</span></div>
                `;
                const btn = document.createElement('button');
                btn.className = 'action-btn';
                btn.textContent = 'ANALYZE';
                btn.addEventListener('click', () => {
                    if (item.media_type === 'person') analyzePerson(item.id);
                    else analyzeMovie(item.id, item.media_type === 'tv' ? 'tv' : 'movie');
                });
                div.appendChild(btn);
                resDiv.appendChild(div);
            });
        } else { resDiv.innerHTML = `<p style="font-size:11px;color:#64748b;">No results found.</p>`; }
    } catch (err) { resDiv.innerHTML = `<p style="color:red;font-size:11px;">Connection error.</p>`; }
}

// --- PERSON ANALYSIS (Default Left View: MAP) ---
async function analyzePerson(id) {
    document.getElementById('results-content').innerHTML = '';
    clearVisuals();
    closeSubInspector();
    
    const detRes = await fetch(`https://api.themoviedb.org/3/person/${id}?api_key=${TMDB_API_KEY}`);
    const person = await detRes.json();
    
    const credRes = await fetch(`https://api.themoviedb.org/3/person/${id}/movie_credits?api_key=${TMDB_API_KEY}`);
    const credits = await credRes.json();

    let rawWorks = person.known_for_department === 'Acting' ? credits.cast : credits.crew.filter(c => c.department === person.known_for_department);
    let works = Array.from(new Map(rawWorks.map(item => [item.id, item])).values());

    currentEntity = { type: 'person', id: person.id, name: person.name, job: person.known_for_department, works: works };

    autoSwitchRepertoireTab(person.known_for_department);

    document.getElementById('creators-section').style.display = 'none';
    document.getElementById('financials-section').style.display = 'none';
    renderPersonProfile(person, works.length);
    renderFilmographyList(works);
    
    document.getElementById('timeline-title').innerText = `TIMELINE: ${person.name.toUpperCase()}`;
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
    if (person.known_for_department) detailsHtml += `<div><span class="label">Profession:</span> ${person.known_for_department}</div>`;
    if (person.birthday) detailsHtml += `<div><span class="label">Born:</span> ${person.birthday}</div>`;
    if (person.deathday) detailsHtml += `<div><span class="label">Died:</span> ${person.deathday}</div>`;
    if (person.place_of_birth) detailsHtml += `<div><span class="label">Place:</span> <span class="interactive-link" onclick="geocodeAndZoom('${person.place_of_birth.replace(/'/g, "\\'")}', '${person.name.replace(/'/g, "\\'")}')">${person.place_of_birth}</span></div>`;
    if (totalFilms > 0) detailsHtml += `<div><span class="label">Total Works:</span> ${totalFilms}</div>`;
    
    document.getElementById('entity-details').innerHTML = detailsHtml;
    document.getElementById('entity-bio').innerText = person.biography || '';
    
    const cat = getCategoryFromDepartment(person.known_for_department);
    const repData = repertoire.find(r => r.id === person.id && r.category === cat);
    
    const actionsDiv = document.getElementById('entity-actions');
    actionsDiv.innerHTML = '';

    const wishBtn = document.createElement('button');
    wishBtn.className = `btn-icon ${repData && repData.isWishlist ? 'active-wish' : ''}`;
    wishBtn.innerHTML = SVG_ICONS.bookmark;
    wishBtn.title = repData && repData.isWishlist ? 'Remove from Wishlist' : 'Add to Wishlist';
    wishBtn.onclick = () => toggleEntityWishlist(person.id, cat, person.name);
    actionsDiv.appendChild(wishBtn);

    const repBtn = document.createElement('button');
    repBtn.className = `btn-icon ${repData ? 'active-pinned' : ''}`;
    repBtn.innerHTML = SVG_ICONS.pin;
    repBtn.title = repData ? 'In Repertoire' : 'Add to Repertoire';
    repBtn.onclick = () => forceAddToRepertoire();
    actionsDiv.appendChild(repBtn);
}

// --- MOVIE / SERIES ANALYSIS (Default Left View: TIMELINE with Highlighted Movie) ---
async function analyzeMovie(id, mediaType = 'movie') {
    document.getElementById('results-content').innerHTML = '';
    clearVisuals();
    closeSubInspector();
    
    const endpoint = mediaType === 'tv' ? 'tv' : 'movie';
    const detRes = await fetch(`https://api.themoviedb.org/3/${endpoint}/${id}?api_key=${TMDB_API_KEY}`);
    const movie = await detRes.json();
    
    const credRes = await fetch(`https://api.themoviedb.org/3/${endpoint}/${id}/credits?api_key=${TMDB_API_KEY}`);
    const credits = await credRes.json();

    currentEntity = { type: mediaType, id: movie.id, title: movie.title || movie.name, credits: credits, rawData: movie };

    setRepertoireTab(mediaType === 'tv' ? 'series' : 'movies');

    document.getElementById('filmography-section').style.display = 'none';
    renderMovieProfile(movie, mediaType);
    renderCreatorsBreakdown(credits);
    renderFinancials(movie);
    
    if (movie.production_countries && movie.production_countries.length > 0) {
        movie.production_countries.forEach(c => geocodeAndAddMarker(c.name, movie.title || movie.name));
    }

    const director = credits.crew.find(c => c.job === 'Director');
    if (director) {
        fetchAndPopulateDirectorTimeline(director, movie.id);
    } else {
        const releaseDate = movie.release_date || movie.first_air_date;
        if (releaseDate) {
            document.getElementById('timeline-title').innerText = `TIMELINE: ${movie.title || movie.name}`;
            const year = releaseDate.split('-')[0];
            timelineItems.add({
                id: 'current_movie',
                movieId: movie.id,
                content: `<span class="tl-title">${movie.title || movie.name}</span> <span class="tl-year">(${year})</span>`,
                start: releaseDate,
                title: `🎬 ${movie.title || movie.name}\n📅 Release Date: ${releaseDate}`,
                className: 'active-timeline-node'
            });
            timeline.fit();
        }
    }
    
    switchView('timeline');
}

async function fetchAndPopulateDirectorTimeline(director, highlightMovieId = null) {
    try {
        const credRes = await fetch(`https://api.themoviedb.org/3/person/${director.id}/movie_credits?api_key=${TMDB_API_KEY}`);
        const credits = await credRes.json();
        let works = credits.crew.filter(c => c.job === 'Director');
        
        document.getElementById('timeline-title').innerText = `DIRECTOR TIMELINE: ${director.name.toUpperCase()}`;
        populateTimeline(works, director.name, highlightMovieId);
    } catch (e) { console.error('Error fetching director timeline'); }
}

function renderMovieProfile(movie, mediaType) {
    document.getElementById('entity-profile').style.display = 'block';
    document.getElementById('entity-name').innerText = movie.title || movie.name;
    
    const imgEl = document.getElementById('entity-photo');
    imgEl.src = movie.poster_path ? `https://image.tmdb.org/t/p/w200${movie.poster_path}` : 'data:image/gif;base64,R0lGODlhAQABAAD/ACwAAAAAAQABAAACADs=';
    
    const releaseDate = movie.release_date || movie.first_air_date || '';
    const year = releaseDate ? releaseDate.split('-')[0] : 'UPCOMING';
    const genres = movie.genres ? movie.genres.map(g => g.name).join(', ') : '';
    const runtime = movie.runtime || (movie.episode_run_time ? movie.episode_run_time[0] : null);
    
    let detailsHtml = `<div><span class="label">Year:</span> <span class="interactive-link" onclick="jumpToYear('${releaseDate}')">${year}</span></div>`;
    if (runtime) detailsHtml += `<div><span class="label">Runtime:</span> ${runtime} min</div>`;
    if (genres) detailsHtml += `<div><span class="label">Genres:</span> ${genres}</div>`;
    
    document.getElementById('entity-details').innerHTML = detailsHtml;
    document.getElementById('entity-bio').innerText = movie.overview || '';
    
    const cat = mediaType === 'tv' ? 'series' : 'movies';
    const repData = repertoire.find(r => r.id === movie.id && r.category === cat);
    
    const actionsDiv = document.getElementById('entity-actions');
    actionsDiv.innerHTML = '';

    if (movie.imdb_id) {
        const imdbA = document.createElement('a');
        imdbA.href = `https://www.imdb.com/title/${movie.imdb_id}`;
        imdbA.target = '_blank';
        imdbA.className = 'btn-icon imdb-link';
        imdbA.innerHTML = SVG_ICONS.link;
        imdbA.title = 'Open IMDb Page';
        actionsDiv.appendChild(imdbA);
    }

    const isSeen = repData && repData.seen && repData.seen.includes(movie.id);
    const seenBtn = document.createElement('button');
    seenBtn.className = `btn-icon ${isSeen ? 'active-seen' : ''}`;
    seenBtn.innerHTML = SVG_ICONS.check;
    seenBtn.title = isSeen ? 'Marked as Watched' : 'Mark as Watched';
    seenBtn.onclick = () => toggleMovieSeen(movie.id, cat, movie.title || movie.name);
    actionsDiv.appendChild(seenBtn);

    const isWish = repData && repData.isWishlist;
    const wishBtn = document.createElement('button');
    wishBtn.className = `btn-icon ${isWish ? 'active-wish' : ''}`;
    wishBtn.innerHTML = SVG_ICONS.bookmark;
    wishBtn.title = isWish ? 'In Wishlist' : 'Add to Wishlist';
    wishBtn.onclick = () => toggleEntityWishlist(movie.id, cat, movie.title || movie.name);
    actionsDiv.appendChild(wishBtn);

    const repBtn = document.createElement('button');
    repBtn.className = `btn-icon ${repData ? 'active-pinned' : ''}`;
    repBtn.innerHTML = SVG_ICONS.pin;
    repBtn.title = repData ? 'In Repertoire' : 'Add to Repertoire';
    repBtn.onclick = () => forceAddToRepertoire();
    actionsDiv.appendChild(repBtn);
}

// --- COMMERCIAL PERFORMANCE ---
function renderFinancials(movie) {
    const sec = document.getElementById('financials-section');
    const container = document.getElementById('financials-content');
    
    const budget = movie.budget || 0;
    const revenue = movie.revenue || 0;

    if (budget === 0 && revenue === 0) {
        sec.style.display = 'none';
        return;
    }

    sec.style.display = 'block';

    const profit = revenue - budget;
    const isHit = profit >= 0;
    const roi = budget > 0 ? (revenue / budget).toFixed(2) : 'N/A';

    const fmtUSD = (val) => '$' + val.toLocaleString('en-US');

    const maxVal = Math.max(budget, revenue);
    const budgetPct = maxVal > 0 ? Math.round((budget / maxVal) * 100) : 0;
    const revenuePct = maxVal > 0 ? Math.round((revenue / maxVal) * 100) : 0;

    container.innerHTML = `
        <div class="fin-grid">
            <div class="fin-box">
                <div class="fin-label">BUDGET</div>
                <div class="fin-val">${budget > 0 ? fmtUSD(budget) : 'N/A'}</div>
            </div>
            <div class="fin-box">
                <div class="fin-label">WORLDWIDE GROSS</div>
                <div class="fin-val">${revenue > 0 ? fmtUSD(revenue) : 'N/A'}</div>
            </div>
            <div class="fin-box">
                <div class="fin-label">NET PROFIT / LOSS</div>
                <div class="fin-val" style="color: ${isHit ? 'var(--neon-green)' : '#ef4444'};">${profit !== 0 ? fmtUSD(profit) : 'N/A'}</div>
            </div>
            <div class="fin-box">
                <div class="fin-label">COMMERCIAL STATUS</div>
                <div>
                    <span class="fin-status-tag ${isHit ? 'fin-status-hit' : 'fin-status-flop'}">
                        ${isHit ? 'BLOCKBUSTER / PROFITABLE (' + roi + 'x)' : 'FINANCIAL LOSS'}
                    </span>
                </div>
            </div>
        </div>

        <div class="fin-bar-container">
            <div class="fin-bar-row">
                <div class="fin-bar-header">
                    <span>BUDGET</span>
                    <span>${budget > 0 ? fmtUSD(budget) : 'N/A'}</span>
                </div>
                <div class="fin-bar-bg">
                    <div class="fin-bar-fill-budget" style="width: ${budgetPct}%;"></div>
                </div>
            </div>
            <div class="fin-bar-row">
                <div class="fin-bar-header">
                    <span>WORLDWIDE REVENUE</span>
                    <span>${revenue > 0 ? fmtUSD(revenue) : 'N/A'}</span>
                </div>
                <div class="fin-bar-bg">
                    <div class="fin-bar-fill-revenue" style="width: ${revenuePct}%;"></div>
                </div>
            </div>
        </div>
    `;
}

// --- CAST & CREW BREAKDOWN ---
function renderCreatorsBreakdown(credits) {
    const section = document.getElementById('creators-section');
    const container = document.getElementById('creators-breakdown');
    section.style.display = 'block';
    container.innerHTML = '';

    const rolesMap = [
        { title: 'DIRECTOR', crew: credits.crew.filter(c => c.job === 'Director') },
        { title: 'SCREENPLAY', crew: credits.crew.filter(c => c.department === 'Writing') },
        { title: 'CAMERA', crew: credits.crew.filter(c => c.department === 'Camera') },
        { title: 'MUSIC', crew: credits.crew.filter(c => c.department === 'Sound' || c.job === 'Original Music Composer') },
        { title: 'EDITING', crew: credits.crew.filter(c => c.department === 'Editing') },
        { title: 'CAST', crew: credits.cast }
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
            
            const uniqueCrew = Array.from(new Map(group.crew.map(c => [c.id, c])).values());
            const limit = 4;
            const shownList = uniqueCrew.slice(0, limit);
            const hiddenList = uniqueCrew.slice(limit);

            const appendPersonItem = (person) => {
                const item = document.createElement('span');
                item.className = 'creator-name-item';
                item.innerText = person.name;
                item.onclick = () => openSubInspectorPerson(person.id, currentEntity.id);
                namesDiv.appendChild(item);
            };

            shownList.forEach((person, idx) => {
                appendPersonItem(person);
                if (idx < shownList.length - 1 || hiddenList.length > 0) {
                    const sep = document.createElement('span');
                    sep.style.color = '#334155';
                    sep.innerText = '•';
                    namesDiv.appendChild(sep);
                }
            });

            if (hiddenList.length > 0) {
                const hiddenSpan = document.createElement('span');
                hiddenSpan.style.display = 'none';
                hiddenList.forEach((person, idx) => {
                    const sep = document.createElement('span');
                    sep.style.color = '#334155';
                    sep.innerText = ' • ';
                    hiddenSpan.appendChild(sep);

                    const item = document.createElement('span');
                    item.className = 'creator-name-item';
                    item.innerText = person.name;
                    item.onclick = () => openSubInspectorPerson(person.id, currentEntity.id);
                    hiddenSpan.appendChild(item);
                });

                const moreBtn = document.createElement('span');
                moreBtn.className = 'creator-more-btn';
                moreBtn.innerText = `... (+${hiddenList.length} MORE)`;
                moreBtn.onclick = () => {
                    hiddenSpan.style.display = 'inline';
                    moreBtn.style.display = 'none';
                };

                namesDiv.appendChild(moreBtn);
                namesDiv.appendChild(hiddenSpan);
            }

            groupDiv.appendChild(titleDiv);
            groupDiv.appendChild(namesDiv);
            container.appendChild(groupDiv);
        }
    });
}

// --- SUB-INSPECTOR PANEL ---
async function openSubInspectorPerson(personId, highlightMovieId) {
    const subPanel = document.getElementById('sub-inspector-panel');
    const container = document.getElementById('sub-panel-content');
    subPanel.style.display = 'block';
    container.innerHTML = `<p class="neon-text">LOADING CREATOR ANALYSIS...</p>`;

    try {
        const personRes = await fetch(`https://api.themoviedb.org/3/person/${personId}?api_key=${TMDB_API_KEY}`);
        const person = await personRes.json();

        const credRes = await fetch(`https://api.themoviedb.org/3/person/${personId}/movie_credits?api_key=${TMDB_API_KEY}`);
        const credits = await credRes.json();

        let rawWorks = credits.crew.length > 0 ? credits.crew : credits.cast;
        let works = Array.from(new Map(rawWorks.map(item => [item.id, item])).values())
                .sort((a, b) => new Date(b.release_date || '2099-12-31') - new Date(a.release_date || '2099-12-31'));

        let html = `
            <div style="display:flex; gap:16px; margin-bottom:15px; border-bottom:1px solid #1e1e2e; padding-bottom:15px;">
                <img src="${person.profile_path ? 'https://image.tmdb.org/t/p/w200' + person.profile_path : 'data:image/gif;base64,R0lGODlhAQABAAD/ACwAAAAAAQABAAACADs='}" style="width:100px; height:145px; object-fit:cover; border:1px solid var(--neon-blue); border-radius:3px;">
                <div style="flex:1;">
                    <h4 class="neon-text" style="margin:0 0 6px 0; font-size:16px;">${person.name}</h4>
                    <div style="font-size:11px; color:var(--neon-orange); font-weight:800; margin-bottom:6px;">${person.known_for_department || ''}</div>
                    <div style="font-size:12px; color:#e2e8f0; line-height:1.5;">
                        ${person.birthday ? '<div><strong style="color:#fff;">Born:</strong> ' + person.birthday + '</div>' : ''}
                        ${person.place_of_birth ? '<div><strong style="color:#fff;">Place:</strong> ' + person.place_of_birth + '</div>' : ''}
                        <div><strong style="color:#fff;">Total Works:</strong> ${works.length}</div>
                    </div>
                    <button class="action-btn" style="margin-top:10px; padding:4px 10px; font-size:10px;" onclick="analyzePerson(${person.id})">INSPECT IN MAIN PANEL ➔</button>
                </div>
            </div>
            
            <div style="margin-bottom:15px;">
                <h5 style="color:var(--neon-orange); margin:0 0 5px 0; font-size:11px; font-weight:800; letter-spacing:1px;">BIOGRAPHY</h5>
                <div style="font-size:11px; color:#cbd5e1; line-height:1.5; max-height:120px; overflow-y:auto;">${person.biography || 'No biography available.'}</div>
            </div>

            <h4 style="color:var(--neon-orange); border-bottom:1px solid #1e1e2e; padding-bottom:4px; font-size:11px; font-weight:800; letter-spacing:1px;">FULL FILMOGRAPHY (${works.length})</h4>
            <div class="list-container">
        `;

        const currentYear = new Date().getFullYear();

        works.forEach(w => {
            const isHighlighted = w.id === highlightMovieId;
            const releaseYear = w.release_date ? parseInt(w.release_date.split('-')[0]) : null;
            const isUpcoming = !w.release_date || releaseYear > currentYear;
            const yearStr = releaseYear ? releaseYear : 'TBA';

            if (!isUpcoming || showUpcoming) {
                html += `
                    <div class="film-item ${isHighlighted ? 'highlighted-film' : ''} ${isUpcoming ? 'upcoming-film' : ''}">
                        <div class="film-info">
                            <span class="film-year" onclick="jumpToYear('${w.release_date}')">${yearStr}</span>
                            <span class="film-title" onclick="analyzeMovie(${w.id})">${w.title} ${isUpcoming ? '<span class="upcoming-badge-subtle">UPCOMING</span>' : ''} ${isHighlighted ? '◄ (ACTIVE)' : ''}</span>
                        </div>
                    </div>
                `;
            }
        });

        html += `</div>`;
        container.innerHTML = html;

    } catch (e) {
        container.innerHTML = `<p style="color:red;font-size:11px;">Failed to load creator analysis.</p>`;
    }
}

function closeSubInspector() {
    document.getElementById('sub-inspector-panel').style.display = 'none';
}

// --- TOGGLE DISCRETE UPCOMING MOVIES ---
function toggleUpcoming() {
    showUpcoming = !showUpcoming;
    const btn = document.getElementById('upcoming-toggle-btn');
    if (btn) {
        btn.classList.toggle('active', showUpcoming);
    }

    if (currentEntity && currentEntity.works) {
        renderFilmographyList(currentEntity.works);
        populateTimeline(currentEntity.works, currentEntity.name);
    }
}

// --- RENDER FILMOGRAPHY LIST ---
function toggleFilmographySort() {
    filmographySortOrder = filmographySortOrder === 'desc' ? 'asc' : 'desc';
    const btn = document.getElementById('filmography-sort-btn');
    btn.innerHTML = `<span>${filmographySortOrder === 'desc' ? 'NEWEST FIRST' : 'OLDEST FIRST'}</span> ↕`;
    if (currentEntity && currentEntity.works) {
        renderFilmographyList(currentEntity.works);
    }
}

function renderFilmographyList(works) {
    const listDiv = document.getElementById('filmography-list');
    document.getElementById('filmography-section').style.display = 'block';
    listDiv.innerHTML = '';

    const currentYear = new Date().getFullYear();

    let filteredWorks = works.filter(m => {
        if (showUpcoming) return true;
        if (!m.release_date) return false;
        const rYear = parseInt(m.release_date.split('-')[0]);
        return rYear <= currentYear;
    });

    const sortedWorks = [...filteredWorks].sort((a, b) => {
        const dateA = new Date(a.release_date || '2099-12-31');
        const dateB = new Date(b.release_date || '2099-12-31');
        return filmographySortOrder === 'desc' ? dateB - dateA : dateA - dateB;
    });

    const cat = getCategoryFromDepartment(currentEntity.job);
    const repData = repertoire.find(r => r.id === currentEntity.id && r.category === cat);
    const seenArray = repData ? repData.seen : [];
    const wishArray = repData ? (repData.wish || []) : [];

    sortedWorks.forEach(m => {
        const releaseYear = m.release_date ? parseInt(m.release_date.split('-')[0]) : null;
        const isUpcoming = !m.release_date || releaseYear > currentYear;
        const yearStr = releaseYear ? releaseYear : 'TBA';

        const isSeen = seenArray.includes(m.id);
        const isWish = wishArray.includes(m.id);

        const div = document.createElement('div');
        div.className = `film-item ${isUpcoming ? 'upcoming-film' : ''}`;

        const infoDiv = document.createElement('div');
        infoDiv.className = 'film-info';
        
        const yearSpan = document.createElement('span');
        yearSpan.className = 'film-year';
        yearSpan.textContent = yearStr;
        yearSpan.onclick = () => jumpToYear(m.release_date);

        const titleSpan = document.createElement('span');
        titleSpan.className = 'film-title';
        titleSpan.innerHTML = `${m.title} ${isUpcoming ? '<span class="upcoming-badge-subtle">UPCOMING</span>' : ''}`;
        titleSpan.onclick = () => analyzeMovie(m.id);

        infoDiv.appendChild(yearSpan);
        infoDiv.appendChild(titleSpan);

        const actionsDiv = document.createElement('div');
        actionsDiv.className = 'film-actions';

        const seenBtn = document.createElement('button');
        seenBtn.className = `btn-icon ${isSeen ? 'active-seen' : ''}`;
        seenBtn.innerHTML = SVG_ICONS.check;
        seenBtn.title = 'Watched';
        seenBtn.onclick = () => toggleFilmStatus(m.id, 'seen');

        const wishBtn = document.createElement('button');
        wishBtn.className = `btn-icon ${isWish && !isSeen ? 'active-wish' : ''}`;
        wishBtn.innerHTML = SVG_ICONS.circle;
        wishBtn.title = 'Want to watch';
        wishBtn.onclick = () => toggleFilmStatus(m.id, 'wish');

        actionsDiv.appendChild(seenBtn);
        actionsDiv.appendChild(wishBtn);

        div.appendChild(infoDiv);
        div.appendChild(actionsDiv);
        listDiv.appendChild(div);
    });
}

// --- REPERTOIRE & WISHLIST SPLIT SCREEN DRAWER ---
function toggleWishlistDrawer() {
    isWishlistDrawerOpen = !isWishlistDrawerOpen;
    const col = document.getElementById('rep-wishlist-col');
    const btn = document.getElementById('btn-toggle-wishlist');
    
    if (col && btn) {
        col.classList.toggle('open', isWishlistDrawerOpen);
        btn.classList.toggle('active-wish', isWishlistDrawerOpen);
    }
    renderWishlistDrawer();
}

function setRepertoireTab(cat) {
    activeRepertoireTab = cat;
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
    touchCategory(cat);
    
    let repItem = repertoire.find(r => r.id === currentEntity.id && r.category === cat);
    
    if (!repItem) {
        repItem = { id: currentEntity.id, name: currentEntity.name, category: cat, total: currentEntity.works.length, seen: [], wish: [], pinned: false, isWishlist: false, hidden: false };
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

function toggleMovieSeen(movieId, cat, title) {
    touchCategory(cat);
    let item = repertoire.find(r => r.id === movieId && r.category === cat);
    if (!item) {
        item = { id: movieId, name: title, category: cat, total: 1, seen: [movieId], wish: [], pinned: false, isWishlist: false, hidden: false };
        repertoire.push(item);
    } else {
        if (item.seen.includes(movieId)) {
            item.seen = item.seen.filter(id => id !== movieId);
        } else {
            item.seen.push(movieId);
        }
    }
    saveRepertoire();
    if (currentEntity && currentEntity.id === movieId) {
        renderMovieProfile(currentEntity.rawData, currentEntity.type);
    }
}

function toggleEntityWishlist(id, cat, name) {
    touchCategory(cat);
    let item = repertoire.find(r => r.id === id && r.category === cat);
    if (!item) {
        item = { id: id, name: name, category: cat, total: 1, seen: [], wish: [], pinned: false, isWishlist: true, hidden: false };
        repertoire.push(item);
    } else {
        item.isWishlist = !item.isWishlist;
    }
    saveRepertoire();
    if (currentEntity) {
        if (currentEntity.type === 'person') renderPersonProfile(currentEntity, currentEntity.works.length);
        else renderMovieProfile(currentEntity.rawData, currentEntity.type);
    }
}

function forceAddToRepertoire() {
    if (!currentEntity) return;

    if (currentEntity.type === 'person') {
        const cat = getCategoryFromDepartment(currentEntity.job);
        touchCategory(cat);
        if (!repertoire.find(r => r.id === currentEntity.id && r.category === cat)) {
            repertoire.push({ id: currentEntity.id, name: currentEntity.name, category: cat, total: currentEntity.works.length, seen: [], wish: [], pinned: false, isWishlist: false, hidden: false });
            saveRepertoire();
            renderPersonProfile(currentEntity, currentEntity.works.length);
        }
    } else {
        const cat = currentEntity.type === 'tv' ? 'series' : 'movies';
        touchCategory(cat);
        if (!repertoire.find(r => r.id === currentEntity.id && r.category === cat)) {
            repertoire.push({ id: currentEntity.id, name: currentEntity.title, category: cat, total: 1, seen: [currentEntity.id], wish: [], pinned: false, isWishlist: false, hidden: false });
        }

        if (currentEntity.credits && currentEntity.credits.crew) {
            const dir = currentEntity.credits.crew.find(c => c.job === 'Director');
            if (dir) {
                touchCategory('directors');
                if (!repertoire.find(r => r.id === dir.id && r.category === 'directors')) {
                    repertoire.push({ id: dir.id, name: dir.name, category: 'directors', total: 10, seen: [currentEntity.id], wish: [], pinned: false, isWishlist: false, hidden: false });
                }
            }
        }

        saveRepertoire();
        renderMovieProfile(currentEntity.rawData, currentEntity.type);
    }
}

function toggleRepertoireAttr(id, cat, attr) {
    touchCategory(cat);
    const item = repertoire.find(r => r.id === id && r.category === cat);
    if (item) {
        item[attr] = !item[attr];
        saveRepertoire();
    }
}

function saveRepertoire() {
    localStorage.setItem('cinematicRepertoirePRO_v9', JSON.stringify(repertoire));
    renderRepertoire();
    renderWishlistDrawer();
}

function calculateScoreColor(seen, total) {
    if (total === 0) return '#5b21b6';
    const ratio = Math.min(seen / total, 1);
    
    if (ratio < 0.5) {
        const t = ratio / 0.5;
        const r = Math.round(91 + (249 - 91) * t);
        const g = Math.round(33 + (115 - 33) * t);
        const b = Math.round(182 - 160 * t);
        return `rgb(${r}, ${g}, ${b})`;
    } else {
        const t = (ratio - 0.5) / 0.5;
        const r = Math.round(249 - 233 * t);
        const g = Math.round(115 + (70) * t);
        const b = Math.round(22 + 107 * t);
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
        listDiv.innerHTML = `<p style="font-size:11px; color:#475569; text-align:center; margin-top:10px;">No items in this tab.</p>`;
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

        const wishBtn = document.createElement('button');
        wishBtn.className = `btn-icon ${item.isWishlist ? 'active-wish' : ''}`;
        wishBtn.innerHTML = SVG_ICONS.bookmark;
        wishBtn.title = item.isWishlist ? 'Remove from Wishlist' : 'Add to Wishlist';
        wishBtn.onclick = (e) => { e.stopPropagation(); toggleRepertoireAttr(item.id, item.category, 'isWishlist'); };

        const pinBtn = document.createElement('button');
        pinBtn.className = `btn-icon ${item.pinned ? 'active-pinned' : ''}`;
        pinBtn.innerHTML = SVG_ICONS.pin;
        pinBtn.title = 'Pin to top';
        pinBtn.onclick = (e) => { e.stopPropagation(); toggleRepertoireAttr(item.id, item.category, 'pinned'); };

        const hideBtn = document.createElement('button');
        hideBtn.className = 'btn-icon';
        hideBtn.innerHTML = SVG_ICONS.eye;
        hideBtn.title = 'Hide';
        hideBtn.onclick = (e) => { e.stopPropagation(); toggleRepertoireAttr(item.id, item.category, 'hidden'); };

        actionsDiv.appendChild(wishBtn);
        actionsDiv.appendChild(pinBtn);
        actionsDiv.appendChild(hideBtn);

        div.appendChild(infoDiv);
        div.appendChild(actionsDiv);
        listDiv.appendChild(div);
    });
}

function renderWishlistDrawer() {
    const listDiv = document.getElementById('wishlist-list');
    const badge = document.getElementById('wishlist-count-badge');
    if (!listDiv) return;

    listDiv.innerHTML = '';
    const wishlistItems = repertoire.filter(item => item.isWishlist && !item.hidden);

    if (badge) badge.textContent = `(${wishlistItems.length})`;

    if (wishlistItems.length === 0) {
        listDiv.innerHTML = `<p style="font-size:10px; color:#475569; text-align:center; margin-top:15px;">Wishlist is empty.</p>`;
        return;
    }

    wishlistItems.forEach(item => {
        const isMedia = item.category === 'movies' || item.category === 'series';
        
        const div = document.createElement('div');
        div.className = 'repertoire-item';
        div.style.borderLeftColor = 'var(--neon-yellow)';
        
        const infoDiv = document.createElement('div');
        infoDiv.className = 'rep-info';
        infoDiv.onclick = () => {
            if (isMedia) analyzeMovie(item.id, item.category === 'series' ? 'tv' : 'movie');
            else analyzePerson(item.id);
        };

        infoDiv.innerHTML = `<span class="rep-name">${item.name}</span><span style="font-size:9px; color:#64748b; text-transform:uppercase;">${item.category}</span>`;

        const actionsDiv = document.createElement('div');
        actionsDiv.className = 'rep-actions';

        const removeBtn = document.createElement('button');
        removeBtn.className = 'btn-icon active-wish';
        removeBtn.innerHTML = SVG_ICONS.bookmark;
        removeBtn.title = 'Remove from Wishlist';
        removeBtn.onclick = (e) => { e.stopPropagation(); toggleRepertoireAttr(item.id, item.category, 'isWishlist'); };

        actionsDiv.appendChild(removeBtn);

        div.appendChild(infoDiv);
        div.appendChild(actionsDiv);
        listDiv.appendChild(div);
    });
}

// --- HELPER FUNCTIONS FOR TIMELINE POPULATION ---
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

function populateTimeline(works, groupName, highlightMovieId = null) {
    timelineItems.clear();
    const currentYear = new Date().getFullYear();

    works.forEach((m, idx) => {
        const releaseYear = m.release_date ? parseInt(m.release_date.split('-')[0]) : null;
        const isUpcoming = !m.release_date || releaseYear > currentYear;

        if (!isUpcoming || showUpcoming) {
            const startDate = m.release_date || `${currentYear + 2}-01-01`;
            const yearStr = releaseYear ? releaseYear : 'TBA';
            const isHighlighted = highlightMovieId && m.id === highlightMovieId;

            let nodeClass = 'film-node';
            if (isUpcoming) nodeClass = 'upcoming-node';
            if (isHighlighted) nodeClass += ' active-timeline-node';

            const fullDate = m.release_date ? m.release_date : 'Unknown release date';
            const tooltipText = `🎬 ${m.title}\n📅 Release Date: ${fullDate}${isUpcoming ? ' (Upcoming)' : ''}`;

            timelineItems.add({
                id: idx,
                movieId: m.id,
                content: `<span class="tl-title">${m.title}</span> <span class="tl-year">(${yearStr})</span>`,
                start: startDate,
                title: tooltipText,
                className: nodeClass
            });
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
            
            currentMarkers.forEach(m => m.remove());
            currentMarkers = [];

            const el = document.createElement('div');
            el.className = 'custom-marker';
            const popup = new mapboxgl.Popup({ offset: 12 }).setHTML(`<div style="color:var(--neon-orange);font-weight:700;font-size:11px;">${title}</div><div style="font-size:10px;color:#94a3b8;">${locationString}</div>`);
            const marker = new mapboxgl.Marker(el).setLngLat(center).setPopup(popup).addTo(map);
            currentMarkers.push(marker);

            map.flyTo({ center: center, zoom: 5, essential: true });
        }
    } catch (e) { console.error("Geocoding failed."); }
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
            const popup = new mapboxgl.Popup({ offset: 12 }).setHTML(`<div style="color:var(--neon-orange);font-weight:700;font-size:11px;">Production Location: ${locationString}</div><div style="font-size:10px;color:#cbd5e1;">🎬 ${movieTitle}</div>`);
            const marker = new mapboxgl.Marker(el).setLngLat([lng, lat]).setPopup(popup).addTo(map);
            currentMarkers.push(marker);
        }
    } catch (e) {}
}

window.onload = initApp;
