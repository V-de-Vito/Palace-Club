// ==========================================
// CONFIGURATION SUPABASE
// ==========================================
const SUPABASE_URL = 'https://htoiiraxwckvhqpctsfc.supabase.co';
const SUPABASE_KEY = 'sb_publishable_rVFv7J66DH8xdE0oY9jqXQ_ir4BbrkW';
const supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

// ==========================================
// UTILITAIRES & ROUTAGE
// ==========================================
const pageType = document.body.getAttribute('data-page');

// Afficher un message de statut
function showMessage(elementId, text, isError = false) {
    const el = document.getElementById(elementId);
    if (!el) return;
    el.innerHTML = `<div class="alert ${isError ? 'alert-error' : 'alert-success'}">${text}</div>`;
    setTimeout(() => el.innerHTML = '', 5000);
}

// Vérification de la session en cours
async function checkAuth() {
    const { data: { session } } = await supabase.auth.getSession();
    
    if (pageType === 'legal' || pageType === 'illegal') {
        if (!session) {
            window.location.href = 'index.html'; // Redirige si non connecté
            return null;
        }
        // Récupérer le rôle
        const { data: profile } = await supabase.from('profiles').select('role').eq('id', session.user.id).single();
        
        if (pageType === 'illegal' && profile.role !== 'admin') {
            alert('ACCÈS REFUSÉ');
            window.location.href = 'dashboard-legal.html';
        }
        
        // UI Globale Dashboard
        const userInfo = document.getElementById('userInfo');
        if (userInfo) userInfo.textContent = `${session.user.email} (${profile.role})`;
        
        if (profile.role === 'admin' && document.getElementById('linkIllegal')) {
            document.getElementById('linkIllegal').classList.remove('hidden');
        }
        
        // Bloquer la facturation pour le Gouv
        if (profile.role === 'gouv' && document.getElementById('billingSection')) {
            document.getElementById('billingSection').classList.add('hidden');
        }

        return { session, role: profile.role };
    }
    return session ? { session } : null;
}

// Déconnexion
if (document.getElementById('logoutBtn')) {
    document.getElementById('logoutBtn').addEventListener('click', async (e) => {
        e.preventDefault();
        await supabase.auth.signOut();
        window.location.href = 'index.html';
    });
}

// ==========================================
// LOGIQUE PAGE PUBLIQUE (INDEX)
// ==========================================
if (!pageType) {
    // Toggle Formulaire de connexion
    document.getElementById('loginBtn').addEventListener('click', (e) => {
        e.preventDefault();
        document.getElementById('loginSection').classList.toggle('hidden');
    });

    // Formulaire de réservation
    document.getElementById('reservationForm').addEventListener('submit', async (e) => {
        e.preventDefault();
        const nom = document.getElementById('resName').value;
        const phone = document.getElementById('resPhone').value;
        const details = document.getElementById('resDetails').value;

        const { error } = await supabase.from('reservations').insert([{ nom, telephone: phone, details }]);
        if (error) showMessage('res-msg', 'Erreur lors de la réservation', true);
        else {
            showMessage('res-msg', 'Réservation envoyée avec succès !');
            e.target.reset();
        }
    });

    // Login
    document.getElementById('loginForm').addEventListener('submit', async (e) => {
        e.preventDefault();
        const email = document.getElementById('loginEmail').value;
        const password = document.getElementById('loginPassword').value;

        const { data, error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) showMessage('login-msg', 'Identifiants invalides', true);
        else window.location.href = 'dashboard-legal.html';
    });
}

// ==========================================
// LOGIQUE DASHBOARD LÉGAL
// ==========================================
if (pageType === 'legal') {
    let inventoryData = [];

    async function loadLegalData() {
        // 1. Charger Inventaire
        const { data: inv } = await supabase.from('inventory').select('*').eq('category', 'legal');
        inventoryData = inv || [];
        
        const invTbody = document.querySelector('#inventoryTable tbody');
        const billItemSelect = document.getElementById('billItem');
        invTbody.innerHTML = '';
        billItemSelect.innerHTML = '<option value="">Sélectionner un article...</option>';

        inventoryData.forEach(item => {
            invTbody.innerHTML += `<tr><td>${item.item_name}</td><td>${item.quantity}</td><td>$${item.price}</td></tr>`;
            billItemSelect.innerHTML += `<option value="${item.id}" data-price="${item.price}">${item.item_name} ($${item.price})</option>`;
        });

        // 2. Charger Transactions
        const { data: trans } = await supabase.from('transactions').select('*').eq('category', 'legal').order('created_at', { ascending: false }).limit(10);
        const transTbody = document.querySelector('#transactionsTable tbody');
        transTbody.innerHTML = '';
        (trans || []).forEach(t => {
            const date = new Date(t.created_at).toLocaleString();
            const color = t.type === 'entree' ? 'green' : 'red';
            transTbody.innerHTML += `<tr><td>${date}</td><td style="color:${color}">${t.type}</td><td>$${t.amount}</td><td>${t.description}</td></tr>`;
        });

        // 3. Charger Réservations
        const { data: res } = await supabase.from('reservations').select('*').eq('statut', 'En attente').order('created_at', { ascending: false });
        const resTbody = document.querySelector('#reservationsTable tbody');
        resTbody.innerHTML = '';
        (res || []).forEach(r => {
            resTbody.innerHTML += `<tr><td>${r.nom}</td><td>${r.telephone}</td><td>${r.details}</td></tr>`;
        });
    }

    // Calcul direct du prix
    document.getElementById('billFormGroup')?.addEventListener('input', updatePrice);
    document.getElementById('billItem')?.addEventListener('change', updatePrice);
    document.getElementById('billQty')?.addEventListener('input', updatePrice);

    function updatePrice() {
        const select = document.getElementById('billItem');
        const qty = document.getElementById('billQty').value;
        if(select.selectedIndex > 0) {
            const price = select.options[select.selectedIndex].getAttribute('data-price');
            document.getElementById('billTotal').innerText = (price * qty).toFixed(2);
        }
    }

    // Facturation
    document.getElementById('billingForm')?.addEventListener('submit', async (e) => {
        e.preventDefault();
        const itemId = document.getElementById('billItem').value;
        const qty = parseInt(document.getElementById('billQty').value);
        const total = parseFloat(document.getElementById('billTotal').innerText);
        const itemName = document.getElementById('billItem').options[document.getElementById('billItem').selectedIndex].text;

        if(!itemId || qty <= 0) return;

        // Baisse du stock
        const currentItem = inventoryData.find(i => i.id == itemId);
        await supabase.from('inventory').update({ quantity: currentItem.quantity - qty }).eq('id', itemId);

        // Ajout Transaction
        await supabase.from('transactions').insert([{
            amount: total, type: 'entree', description: `Vente Bar: ${qty}x ${itemName}`, category: 'legal'
        }]);

        loadLegalData();
        e.target.reset();
        document.getElementById('billTotal').innerText = '0';
    });

    checkAuth().then(auth => { if(auth) loadLegalData(); });
}

// ==========================================
// LOGIQUE DASHBOARD ILLÉGAL
// ==========================================
if (pageType === 'illegal') {
    let illInv = {};

    async function loadIllegalData() {
        // Charger Stocks
        const { data: inv } = await supabase.from('inventory').select('*').eq('category', 'illegal');
        const tbody = document.querySelector('#illegalInventoryTable tbody');
        tbody.innerHTML = '';
        inv.forEach(item => {
            illInv[item.item_name] = item;
            tbody.innerHTML += `<tr><td>${item.item_name}</td><td>${item.quantity}</td></tr>`;
        });

        // Charger Logs
        const { data: logs } = await supabase.from('illegal_logs').select('*').order('created_at', { ascending: false }).limit(15);
        const logTbody = document.querySelector('#logsTable tbody');
        logTbody.innerHTML = '';
        (logs || []).forEach(l => {
            const date = new Date(l.created_at).toLocaleString();
            logTbody.innerHTML += `<tr><td>${date}</td><td>${l.action}</td><td>${l.details}</td></tr>`;
        });
    }

    async function logAction(action, details) {
        await supabase.from('illegal_logs').insert([{ action, details }]);
        loadIllegalData();
    }

    // Automatisation : Plantation
    document.getElementById('btnPlant')?.addEventListener('click', async () => {
        if (illInv['Graine'].quantity >= 1 && illInv['Terreau'].quantity >= 1 && illInv['Lampe'].quantity >= 1 && illInv['Eau'].quantity >= 2) {
            
            // Consommation
            await supabase.from('inventory').update({ quantity: illInv['Graine'].quantity - 1 }).eq('id', illInv['Graine'].id);
            await supabase.from('inventory').update({ quantity: illInv['Terreau'].quantity - 1 }).eq('id', illInv['Terreau'].id);
            await supabase.from('inventory').update({ quantity: illInv['Lampe'].quantity - 1 }).eq('id', illInv['Lampe'].id);
            await supabase.from('inventory').update({ quantity: illInv['Eau'].quantity - 2 }).eq('id', illInv['Eau'].id);
            
            // Production
            await supabase.from('inventory').update({ quantity: illInv['Têtes'].quantity + 10 }).eq('id', illInv['Têtes'].id);
            
            logAction('Plantation', 'Lancement culture: -1 Graine, -1 Terreau, -1 Lampe, -2 Eau | +10 Têtes');
            showMessage('illegal-msg', 'Plantation réussie. +10 Têtes récoltées.');
        } else {
            showMessage('illegal-msg', 'Ressources insuffisantes pour planter.', true);
        }
    });

    // Automatisation : Traitement
    document.getElementById('btnTreat')?.addEventListener('click', async () => {
        if (illInv['Têtes'].quantity >= 10 && illInv['Pochons Vides'].quantity >= 5) {
            await supabase.from('inventory').update({ quantity: illInv['Têtes'].quantity - 10 }).eq('id', illInv['Têtes'].id);
            await supabase.from('inventory').update({ quantity: illInv['Pochons Vides'].quantity - 5 }).eq('id', illInv['Pochons Vides'].id);
            await supabase.from('inventory').update({ quantity: illInv['Weed (Pochon)'].quantity + 5 }).eq('id', illInv['Weed (Pochon)'].id);
            
            logAction('Traitement', 'Conditionnement: -10 Têtes, -5 Pochons vides | +5 Pochons Weed');
            showMessage('illegal-msg', 'Traitement terminé. +5 Pochons de Weed.');
        } else {
            showMessage('illegal-msg', 'Matière première insuffisante.', true);
        }
    });

    // Vente
    document.getElementById('btnSellWeed')?.addEventListener('click', async () => {
        if (illInv['Weed (Pochon)'].quantity >= 1) {
            await supabase.from('inventory').update({ quantity: illInv['Weed (Pochon)'].quantity - 1 }).eq('id', illInv['Weed (Pochon)'].id);
            await supabase.from('transactions').insert([{ amount: 20, type: 'entree', description: 'Vente 1 Pochon Weed (Rue)', category: 'illegal' }]);
            logAction('Vente', '1 Pochon de Weed vendu ($20)');
            showMessage('illegal-msg', 'Vente réussie ! +$20');
        } else {
            showMessage('illegal-msg', 'Plus de pochons à vendre.', true);
        }
    });

    // Achat matières
    document.getElementById('btnBuyRaw')?.addEventListener('click', async () => {
        await supabase.from('inventory').update({ quantity: illInv['Graine'].quantity + 1 }).eq('id', illInv['Graine'].id);
        await supabase.from('inventory').update({ quantity: illInv['Terreau'].quantity + 1 }).eq('id', illInv['Terreau'].id);
        await supabase.from('inventory').update({ quantity: illInv['Lampe'].quantity + 1 }).eq('id', illInv['Lampe'].id);
        await supabase.from('inventory').update({ quantity: illInv['Eau'].quantity + 2 }).eq('id', illInv['Eau'].id);
        
        await supabase.from('transactions').insert([{ amount: 67, type: 'sortie', description: 'Achat Kit Pousse sur le Darknet', category: 'illegal' }]);
        logAction('Achat', 'Kit de pousse acheté pour $67');
        showMessage('illegal-msg', 'Kit de pousse reçu dans les stocks.');
    });

    checkAuth().then(auth => { if(auth) loadIllegalData(); });
}