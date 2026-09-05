/**
 * Compact Indonesian word list for server-side validation of "Sambung Kata".
 * This is intentionally a broad but finite set of common nouns/adjectives/verbs
 * covering a wide range of starting letters so chains stay playable.
 * Stored as a Set for O(1) lookup. Words are lowercase, no spaces.
 */
export const WORD_LIST = [
  "api","ayam","anggur","angin","awan","abu","asap","apel","atap","asin",
  "anjing","angsa","anak","aman","antik","asli","abadi","angka","aksi","alis",
  "bola","buku","batu","bunga","baju","bumi","bulan","bintang","biru","besar",
  "berani","budaya","bahasa","biji","balon","bebek","beruang","badak","biru",
  "cerdas","cinta","cepat","coklat","celana","cermin","cangkir","cantik",
  "cerita","curang","catur","cabai","cacing","cuaca","cakar",
  "dunia","daun","danau","dinding","dosen","dompet","dua","dansa","dadu",
  "domba","duduk","dingin","dalam","dekat","dagu","dansa",
  "elang","emas","enak","ekor","empat","embun","emosi","evolusi","efek",
  "faktor","foto","filter","festival","fajar","filsafat","fokus","famili",
  "gajah","gula","gunung","gitar","garam","gelap","gembira","gading","goreng",
  "gambar","gerak","gedung","garuda","gerbang",
  "harimau","hujan","hutan","hitam","hijau","hangat","harum","hemat","hobi",
  "huruf","hari","hadiah","halaman","hormat",
  "ikan","indah","istana","ibu","ilmu","impian","iklan","imut","istri",
  "jalan","jendela","jantung","jagung","jarum","jaket","jujur","juara",
  "jembatan","jeruk","janji","jamur","jaring",
  "kucing","kuda","kereta","kertas","kunci","kopi","kamera","kabut","kaya",
  "kuning","kentang","keju","kelinci","kupu","kayu","kaki","kaca","kado",
  "lampu","laut","langit","lemari","lembut","layar","lada","lezat","lucu",
  "lumba","lampion","lidah","lagu","lantai","liburan","luas",
  "meja","matahari","mangga","musik","mobil","merah","malam","manis","mata",
  "mimpi","murah","mawar","mesin","monyet","musim","macan",
  "naga","nyanyi","nasi","nenek","norma","nasib","nelayan","nyaman","nomor",
  "obat","oren","otak","olahraga","obor","ombak","organik",
  "pisang","padi","perahu","payung","pohon","panas","pantai","pesawat",
  "putih","piring","pintu","pasir","pelangi","penyu","pizza","pensil",
  "presiden","panda",
  "quran","quiz",
  "rumah","roti","raja","rambut","rusa","roda","rantai","rajin","rambutan",
  "rimba","rantai","ratu",
  "sapi","sungai","sepatu","sekolah","surat","senyum","satu","suara","susu",
  "sinar","sabun","sopir","semut","sayur","siang","salju","singa",
  "topi","telur","teman","taman","tikus","teratai","tanah","terang","tinta",
  "tiket","tomat","tenda","tarian","turis","teh","tas",
  "ular","udara","udang","umur","unik","unta","umum","universitas",
  "vitamin","virus","voli","visi","vokal",
  "warna","waktu","wangi","wajah","wortel","warung","wayang",
  "yakin","yatim","yoga",
  "zebra","zaman","zat","zona",
];

export const WORD_SET = new Set(WORD_LIST);

/** Returns true if a lowercase word exists in the dictionary. */
export function isValidWord(word) {
  return WORD_SET.has(word.toLowerCase().trim());
}
