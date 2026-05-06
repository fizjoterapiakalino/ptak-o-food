// --- 1. USTAWIENIE DATY ---
const options = { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' };
document.getElementById('current-date').innerText = new Date().toLocaleDateString('pl-PL', options);

// --- 2. DANE DOMYŚLNE I POBIERANIE Z LOCAL STORAGE ---
const defaultMenu =[
    { id: 1, name: "Schabowy z ziemniakami i mizerią", price: 26.00 },
    { id: 2, name: "Pizza Margherita (32cm)", price: 29.00 },
    { id: 3, name: "Pad Thai z Kurczakiem", price: 34.00 },
    { id: 4, name: "Zupa Pomidorowa", price: 12.00 },
    { id: 5, name: "Burger Drwala z frytkami", price: 38.00 }
];

let dailyMenu = JSON.parse(localStorage.getItem('ptakMenu')) || defaultMenu;
let restaurantName = localStorage.getItem('ptakRestaurant') || "Bistro pod Pijanym Ptakiem";
let orders = JSON.parse(localStorage.getItem('ptakOrders')) ||[];
let history = JSON.parse(localStorage.getItem('ptakHistory')) || [];
let profiles = JSON.parse(localStorage.getItem('ptakProfiles')) || {};

// --- 3. INICJALIZACJA APLIKACJI ---
function initApp() {
    renderRestaurantName();
    renderMenu();
    renderAdminMenu();
    renderOrders();
    renderHistory();
    renderProfileList();
}

// --- TABS LOGIC ---
function switchTab(tabId) {
    if (tabId === 'admin-tab') {
        const pass = prompt("Podaj hasło administratora:");
        if (pass !== "ptak123") {
            if (pass !== null) alert("❌ Błędne hasło!");
            return;
        }
    }

    // Deactivate all
    document.querySelectorAll('.tab-btn').forEach(btn => btn.classList.remove('active'));
    document.querySelectorAll('.tab-content').forEach(content => content.classList.remove('active'));

    // Activate selected
    const activeBtn = document.querySelector(`.tab-btn[onclick*="${tabId}"]`);
    if (activeBtn) activeBtn.classList.add('active');
    
    const activeContent = document.getElementById(tabId);
    if (activeContent) activeContent.classList.add('active');

    if (tabId === 'admin-tab') {
        document.getElementById('admin-restaurant-name').value = restaurantName;
        renderProfileList();
    }
}

// --- 4. FUNKCJE ADMINISTRATORA ---
function updateRestaurantName() {
    const newName = document.getElementById('admin-restaurant-name').value.trim();
    if (newName !== "") {
        restaurantName = newName;
        localStorage.setItem('ptakRestaurant', restaurantName);
        renderRestaurantName();
        alert("Zaktualizowano nazwę restauracji!");
    }
}

function renderRestaurantName() {
    document.getElementById('restaurant-name').innerText = restaurantName;
}

function saveAsProfile() {
    if (dailyMenu.length === 0) {
        alert("Menu jest puste! Dodaj najpierw dania.");
        return;
    }

    const profileName = prompt("Podaj nazwę dla tego szablonu (np. Nazwa Restauracji):", restaurantName);
    if (profileName) {
        profiles[profileName] = {
            name: restaurantName,
            menu: [...dailyMenu]
        };
        localStorage.setItem('ptakProfiles', JSON.stringify(profiles));
        renderProfileList();
        alert(`Zapisano szablon: ${profileName}`);
    }
}

function loadProfile() {
    const profileName = document.getElementById('profile-select').value;
    if (!profileName) {
        alert("Wybierz szablon z listy!");
        return;
    }

    if (confirm(`Czy chcesz wczytać szablon "${profileName}"? Obecne menu zostanie zastąpione.`)) {
        const profile = profiles[profileName];
        restaurantName = profile.name;
        dailyMenu = [...profile.menu];
        
        localStorage.setItem('ptakRestaurant', restaurantName);
        saveMenu(); 
        renderRestaurantName();
        alert(`Wczytano: ${profileName}`);
    }
}

function deleteProfile() {
    const profileName = document.getElementById('profile-select').value;
    if (!profileName) return;

    if (confirm(`Czy na pewno usunąć szablon "${profileName}"?`)) {
        delete profiles[profileName];
        localStorage.setItem('ptakProfiles', JSON.stringify(profiles));
        renderProfileList();
    }
}

function renderProfileList() {
    const select = document.getElementById('profile-select');
    if (!select) return;
    select.innerHTML = '<option value="">-- Wybierz zapisany szablon --</option>';
    
    Object.keys(profiles).forEach(pName => {
        const opt = document.createElement('option');
        opt.value = pName;
        opt.innerText = pName;
        select.appendChild(opt);
    });
}

function addMenuItem() {
    const nameInput = document.getElementById('admin-item-name').value.trim();
    const priceInput = parseFloat(document.getElementById('admin-item-price').value);

    if (nameInput === "" || isNaN(priceInput)) {
        alert("Podaj poprawną nazwę i cenę (np. 15.50).");
        return;
    }

    const newItem = {
        id: Date.now(),
        name: nameInput,
        price: priceInput
    };

    dailyMenu.push(newItem);
    saveMenu();
    
    document.getElementById('admin-item-name').value = "";
    document.getElementById('admin-item-price').value = "";
}

function deleteMenuItem(id) {
    if(confirm("Usunąć tę pozycję z menu?")) {
        dailyMenu = dailyMenu.filter(item => item.id !== id);
        saveMenu();
    }
}

function saveMenu() {
    localStorage.setItem('ptakMenu', JSON.stringify(dailyMenu));
    renderMenu();
    renderAdminMenu();
}

function renderAdminMenu() {
    const adminMenuList = document.getElementById('admin-menu-list');
    if (!adminMenuList) return;
    adminMenuList.innerHTML = "";

    dailyMenu.forEach(item => {
        let li = document.createElement('li');
        li.className = 'menu-item';
        li.innerHTML = `
            <span>${item.name} - <span class="menu-price">${item.price.toFixed(2)} zł</span></span>
            <button class="btn-danger btn-small" onclick="deleteMenuItem(${item.id})">Usuń</button>
        `;
        adminMenuList.appendChild(li);
    });
}

// --- 5. FUNKCJE DLA ZWYKŁEGO UŻYTKOWNIKA ---
function renderMenu() {
    const menuList = document.getElementById('menu-list');
    const itemSelect = document.getElementById('item-select');
    
    if (menuList) menuList.innerHTML = "";
    if (itemSelect) itemSelect.innerHTML = '<option value="">-- Wybierz z menu --</option>';

    dailyMenu.forEach(item => {
        if (menuList) {
            let li = document.createElement('li');
            li.className = 'menu-item';
            li.innerHTML = `${item.name} <span class="menu-price">${item.price.toFixed(2)} zł</span>`;
            menuList.appendChild(li);
        }

        if (itemSelect) {
            let option = document.createElement('option');
            option.value = item.id;
            option.innerText = `${item.name} (${item.price.toFixed(2)} zł)`;
            itemSelect.appendChild(option);
        }
    });
}

function addOrder() {
    const userNameInput = document.getElementById('user-name').value.trim();
    const itemId = parseInt(document.getElementById('item-select').value);
    const noteInput = document.getElementById('order-note').value.trim();

    if (userNameInput === "" || isNaN(itemId)) {
        alert("❗ Proszę wpisać swoje imię i wybrać danie z listy.");
        return;
    }

    const selectedItem = dailyMenu.find(m => m.id === itemId);
    
    const newOrder = {
        id: Date.now(),
        user: userNameInput,
        item: selectedItem,
        note: noteInput,
        paid: false
    };

    orders.push(newOrder);
    saveOrders();
    
    document.getElementById('item-select').value = "";
    document.getElementById('order-note').value = "";
}

function togglePaid(orderId) {
    const order = orders.find(o => o.id === orderId);
    if (order) {
        order.paid = !order.paid;
        saveOrders();
    }
}

function deleteOrder(orderId) {
    orders = orders.filter(o => o.id !== orderId);
    saveOrders();
}

function clearAllOrders() {
    if(confirm("Czy na pewno chcesz wyczyścić dzisiejszą listę BEZ zapisywania do historii?")) {
        orders =[];
        saveOrders();
    }
}

function archiveDay() {
    if (orders.length === 0) {
        alert("Nie ma żadnych zamówień do zapisania!");
        return;
    }

    if (confirm("Czy chcesz zakończyć dzień i zapisać zamówienia do historii?")) {
        const historyEntry = {
            id: Date.now(),
            date: new Date().toLocaleDateString('pl-PL', options),
            restaurant: restaurantName,
            orders: [...orders],
            total: document.getElementById('total-price-value').innerText
        };

        history.unshift(historyEntry); 
        if (history.length > 10) history.pop(); 

        localStorage.setItem('ptakHistory', JSON.stringify(history));
        
        orders = [];
        saveOrders();
        renderHistory();
        alert("Dzień zapisany w historii! 🎉");
    }
}

function saveOrders() {
    localStorage.setItem('ptakOrders', JSON.stringify(orders));
    renderOrders();
}

function renderOrders() {
    const tbody = document.getElementById('orders-body');
    const deliveryFeeInput = document.getElementById('delivery-fee');
    const deliveryCalcInfo = document.getElementById('delivery-calc-info');
    
    if (!tbody) return;
    tbody.innerHTML = "";
    let itemsPrice = 0;

    const deliveryFeeTotal = parseFloat(deliveryFeeInput.value) || 0;
    const uniqueUsers = [...new Set(orders.map(o => o.user))].length;
    const deliveryPerPerson = uniqueUsers > 0 ? (deliveryFeeTotal / uniqueUsers) : 0;

    if (deliveryFeeTotal > 0) {
        deliveryCalcInfo.innerText = `Dostawa: ${deliveryFeeTotal.toFixed(2)} zł / ${uniqueUsers} os. = +${deliveryPerPerson.toFixed(2)} zł/os.`;
    } else {
        deliveryCalcInfo.innerText = "";
    }

    const userDeliveryPaid = {};

    orders.forEach(order => {
        let tr = document.createElement('tr');
        if (order.paid) tr.className = 'paid-row';
        
        let orderDeliveryPart = 0;
        if (!userDeliveryPaid[order.user]) {
            orderDeliveryPart = deliveryPerPerson;
            userDeliveryPaid[order.user] = true;
        }

        const priceWithDelivery = order.item.price + orderDeliveryPart;

        tr.innerHTML = `
            <td><strong>${order.user}</strong></td>
            <td>
                ${order.item.name}
                ${order.note ? `<span class="note-text">💬 ${order.note}</span>` : ""}
            </td>
            <td>${priceWithDelivery.toFixed(2)} zł</td>
            <td>
                <input type="checkbox" ${order.paid ? 'checked' : ''} onchange="togglePaid(${order.id})">
            </td>
            <td><button class="btn-danger btn-small" onclick="deleteOrder(${order.id})">❌</button></td>
        `;
        
        tbody.appendChild(tr);
        itemsPrice += order.item.price;
    });

    const finalTotal = itemsPrice + deliveryFeeTotal;
    const totalPriceElement = document.getElementById('total-price-value');
    if (totalPriceElement) totalPriceElement.innerText = finalTotal.toFixed(2);
}

function renderHistory() {
    const historyList = document.getElementById('history-list');
    if (!historyList) return;
    
    if (history.length === 0) {
        historyList.innerHTML = '<p style="color: #636e72; font-style: italic;">Brak archiwalnych zamówień.</p>';
        return;
    }

    historyList.innerHTML = "";
    history.forEach(entry => {
        const div = document.createElement('div');
        div.className = 'history-item';
        
        let ordersHtml = entry.orders.map(o => `
            <li class="history-order-row">
                <span><strong>${o.user}</strong>: ${o.item.name} ${o.note ? `(${o.note})` : ''}</span>
                <button class="btn-small" onclick="reorder('${o.user}', ${o.item.id}, '${o.note || ''}')">Ponów 🔄</button>
            </li>
        `).join('');

        div.innerHTML = `
            <div class="history-header">
                <span>📅 ${entry.date} - ${entry.restaurant}</span>
                <span>Suma: ${entry.total} zł</span>
            </div>
            <ul class="history-orders">
                ${ordersHtml}
            </ul>
        `;
        historyList.appendChild(div);
    });
}

function reorder(user, itemId, note) {
    document.getElementById('user-name').value = user;
    document.getElementById('item-select').value = itemId;
    document.getElementById('order-note').value = note;
    
    switchTab('orders-tab');
    
    alert(`Uzupełniono formularz dla: ${user}. Kliknij 'Zamawiam!', aby potwierdzić.`);
}

// --- 6. URUCHOMIENIE APLIKACJI NA STARCIE ---
initApp();
