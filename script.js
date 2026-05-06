// --- FIREBASE CONFIGURATION ---
// Values will be replaced by GitHub Secrets during deployment or can be filled manually
const firebaseConfig = {
    apiKey: "AIzaSyCqqX-MlKAVot1maPYOztvG13ZUxfsRjgc",
    authDomain: "ptak-o-food.firebaseapp.com",
    projectId: "ptak-o-food",
    storageBucket: "ptak-o-food.firebasestorage.app",
    messagingSenderId: "668261675451",
    appId: "1:668261675451:web:c6c459211b3339cc06d49e",
    measurementId: "G-YJHBE6F3TX"
};

// Initialize Firebase
firebase.initializeApp(firebaseConfig);
const db = firebase.firestore();

// --- 1. USTAWIENIE DATY ---
const options = { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' };
document.getElementById('current-date').innerText = new Date().toLocaleDateString('pl-PL', options);

// --- 2. STAN APLIKACJI (REALTIME) ---
let dailyMenu = [];
let restaurantName = "Ładowanie...";
let orderLimit = "";
let orders = [];
let history = [];
let profiles = {};

// --- 3. INICJALIZACJA APLIKACJI (LISTENERY REALTIME) ---
function initApp() {
    // 1. Słuchaj ustawień (Restauracja, Menu, Limit)
    db.collection("config").doc("current").onSnapshot((doc) => {
        if (doc.exists) {
            const data = doc.data();
            restaurantName = data.restaurantName || "Bistro pod Pijanym Ptakiem";
            dailyMenu = data.menu || [];
            orderLimit = data.orderLimit || "";
            
            renderRestaurantName();
            renderMenu();
            renderOrderLimitInfo();
            // Przeładuj zamówienia bo ceny w menu mogły się zmienić
            renderOrders();
        } else {
            // Inicjalizacja pustej konfiguracji jeśli nie istnieje
            db.collection("config").doc("current").set({
                restaurantName: "Bistro pod Pijanym Ptakiem",
                menu: [],
                orderLimit: ""
            });
        }
    });

    // 2. Słuchaj zamówień
    db.collection("orders").orderBy("timestamp", "asc").onSnapshot((snapshot) => {
        orders = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        renderOrders();
    });

    // 3. Słuchaj historii (ostatnie 10 dni)
    db.collection("history").orderBy("timestamp", "desc").limit(10).onSnapshot((snapshot) => {
        history = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        renderHistory();
    });

    // 4. Słuchaj szablonów
    db.collection("profiles").onSnapshot((snapshot) => {
        profiles = {};
        snapshot.docs.forEach(doc => {
            profiles[doc.id] = doc.data();
        });
        renderProfileList();
    });
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

    document.querySelectorAll('.tab-btn').forEach(btn => btn.classList.remove('active'));
    document.querySelectorAll('.tab-content').forEach(content => content.classList.remove('active'));

    const activeBtn = document.querySelector(`.tab-btn[onclick*="${tabId}"]`);
    if (activeBtn) activeBtn.classList.add('active');
    
    const activeContent = document.getElementById(tabId);
    if (activeContent) activeContent.classList.add('active');

    if (tabId === 'admin-tab') {
        document.getElementById('admin-restaurant-name').value = restaurantName;
        document.getElementById('admin-order-limit').value = orderLimit;
        renderProfileList();
    }
}

// --- 4. FUNKCJE ADMINISTRATORA ---
function updateOrderLimit() {
    const limitInput = document.getElementById('admin-order-limit').value;
    db.collection("config").doc("current").update({ orderLimit: limitInput })
        .then(() => alert("Zaktualizowano limit czasu!"))
        .catch(err => console.error("Error updating limit:", err));
}

function renderOrderLimitInfo() {
    const infoContainer = document.getElementById('order-limit-display');
    if (!infoContainer) return;

    if (orderLimit) {
        infoContainer.innerHTML = `<br><strong>Zamówienia do godziny:</strong> <strong style="color: var(--secondary);">${orderLimit}</strong>`;
    } else {
        infoContainer.innerHTML = "";
    }
}

function updateRestaurantName() {
    const newName = document.getElementById('admin-restaurant-name').value.trim();
    if (newName !== "") {
        db.collection("config").doc("current").update({ restaurantName: newName })
            .then(() => alert("Zaktualizowano nazwę restauracji!"))
            .catch(err => console.error("Error updating name:", err));
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
        db.collection("profiles").doc(profileName).set({
            name: restaurantName,
            menu: dailyMenu
        }).then(() => alert(`Zapisano szablon: ${profileName}`));
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
        db.collection("config").doc("current").update({
            restaurantName: profile.name,
            menu: profile.menu
        }).then(() => alert(`Wczytano: ${profileName}`));
    }
}

function deleteProfile() {
    const profileName = document.getElementById('profile-select').value;
    if (!profileName) return;

    if (confirm(`Czy na pewno usunąć szablon "${profileName}"?`)) {
        db.collection("profiles").doc(profileName).delete()
            .then(() => alert("Usunięto szablon."));
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

    const updatedMenu = [...dailyMenu, newItem];
    db.collection("config").doc("current").update({ menu: updatedMenu })
        .then(() => {
            document.getElementById('admin-item-name').value = "";
            document.getElementById('admin-item-price').value = "";
        });
}

function deleteMenuItem(id) {
    if(confirm("Usunąć tę pozycję z menu?")) {
        const updatedMenu = dailyMenu.filter(item => item.id !== id);
        db.collection("config").doc("current").update({ menu: updatedMenu });
    }
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

    if (orderLimit) {
        const now = new Date();
        const [limitHours, limitMinutes] = orderLimit.split(':').map(Number);
        const limitDate = new Date();
        limitDate.setHours(limitHours, limitMinutes, 0, 0);

        if (now > limitDate) {
            alert(`❌ Przykro mi, ale czas na składanie zamówień minął o godzinie ${orderLimit}.`);
            return;
        }
    }

    const selectedItem = dailyMenu.find(m => m.id === itemId);
    
    db.collection("orders").add({
        user: userNameInput,
        item: selectedItem,
        note: noteInput,
        paid: false,
        timestamp: firebase.firestore.FieldValue.serverTimestamp()
    }).then(() => {
        document.getElementById('item-select').value = "";
        document.getElementById('order-note').value = "";
    });
}

function togglePaid(orderId) {
    const order = orders.find(o => o.id === orderId);
    if (order) {
        db.collection("orders").doc(orderId).update({ paid: !order.paid });
    }
}

function deleteOrder(orderId) {
    if(confirm("Usunąć to zamówienie?")) {
        db.collection("orders").doc(orderId).delete();
    }
}

async function clearAllOrders() {
    if(confirm("Czy na pewno chcesz wyczyścić dzisiejszą listę BEZ zapisywania do historii?")) {
        const snapshot = await db.collection("orders").get();
        const batch = db.batch();
        snapshot.docs.forEach(doc => batch.delete(doc.ref));
        await batch.commit();
    }
}

async function archiveDay() {
    if (orders.length === 0) {
        alert("Nie ma żadnych zamówień do zapisania!");
        return;
    }

    if (confirm("Czy chcesz zakończyć dzień i zapisać zamówienia do historii?")) {
        const total = document.getElementById('total-price-value').innerText;
        
        await db.collection("history").add({
            date: new Date().toLocaleDateString('pl-PL', options),
            restaurant: restaurantName,
            orders: orders,
            total: total,
            timestamp: firebase.firestore.FieldValue.serverTimestamp()
        });

        // Wyczyść zamówienia
        const snapshot = await db.collection("orders").get();
        const batch = db.batch();
        snapshot.docs.forEach(doc => batch.delete(doc.ref));
        await batch.commit();

        alert("Dzień zapisany w historii! 🎉");
    }
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
                <input type="checkbox" ${order.paid ? 'checked' : ''} onchange="togglePaid('${order.id}')">
            </td>
            <td><button class="btn-danger btn-small" onclick="deleteOrder('${order.id}')">❌</button></td>
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
