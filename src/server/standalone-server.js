const VDSServer = require('./server');

const server = new VDSServer();
const port = process.env.PORT || 8899;

server.start(port).then(() => {
    console.log(`====================================================`);
    console.log(`🚀 VDS Ortak Çalışma Sunucusu Başlatıldı!`);
    console.log(`📡 Port: ${port}`);
    console.log(`🔒 Varsayılan Yönetici: admin`);
    console.log(`🔑 Varsayılan Şifre: Admin123!@#`);
    console.log(`====================================================`);
}).catch(err => {
    console.error('Sunucu başlatma hatası:', err);
    process.exit(1);
});
