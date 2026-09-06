// Offline metadata snapshot. It keeps the interface useful when the public
// catalog temporarily rate-limits the metadata relay. No streams or secrets
// are bundled here.
const PHIM4K_FILTER_METADATA = [
  [["H\u00e0nh \u0110\u1ed9ng", "Khoa h\u1ecdc vi\u1ec5n t\u01b0\u1edfng"], ["\u00c2u M\u1ef9"]],
  [["H\u00e0nh \u0110\u1ed9ng", "H\u00ecnh s\u1ef1"], ["\u00c2u M\u1ef9"]],
  [["H\u00e0i h\u01b0\u1edbc", "H\u00ecnh s\u1ef1"], ["\u00c2u M\u1ef9"]],
  [["Ho\u1ea1t h\u00ecnh", "H\u00e0nh \u0111\u1ed9ng"], ["Nh\u1eadt B\u1ea3n"]],
  [["Ho\u1ea1t h\u00ecnh", "C\u1ed5 trang"], ["Trung Qu\u1ed1c"]],
  [["Ho\u1ea1t h\u00ecnh", "Ch\u00ednh k\u1ecbch"], ["Nh\u1eadt B\u1ea3n"]],
  [["T\u00ecnh c\u1ea3m", "Ch\u00ednh k\u1ecbch"], ["H\u00e0n Qu\u1ed1c"]],
  [["T\u00ecnh c\u1ea3m", "H\u00e0i h\u01b0\u1edbc"], ["H\u00e0n Qu\u1ed1c"]],
];

window.PHIM4K_CATALOG_FALLBACK = Object.freeze([
  ["Chien Tranh Giua Cac Vi Sao: Maul", "chien-tranh-giua-cac-vi-sao-maul-chua-te-bong-toi", "Star Wars: Maul - Shadow Lord", "/media/spider_man_4k.jpg", "/media/spider_man_4k.jpg", 2026],
  ["Quy Ong The Gioi Ngam (Phan 2)", "quy-ong-the-gioi-ngam-phan-2", "The Gentlemen (Season 2)", "/media/the_boys_4k.jpg", "/media/the_boys_4k.jpg", 2026],
  ["Quy Ong The Gioi Ngam (Phan 1)", "quy-ong-the-gioi-ngam-phan-1", "The Gentlemen (Season 1)", "/media/killer_shop_4k.jpg", "/media/killer_shop_4k.jpg", 2024],
  ["Tuyet The Chien Hon", "tuyet-the-chien-hon", "Peerless Battle Spirit", "/media/superman_4k.jpg", "/media/superman_4k.jpg", 2025],
  ["Son Hai Kinh: Thiet Lap Lai Trat Tu", "son-hai-kinh-thiet-lap-lai-trat-tu", "Threads of Fate", "/media/avengers_4k.jpg", "/media/avengers_4k.jpg", 2026],
  ["Ve Xong Di, Roi Hay Chet!", "ve-xong-di-roi-hay-chet", "Draw This, Then Die!", "/media/killer_shop_4k.jpg", "/media/killer_shop_4k.jpg", 2026],
  ["Ve Nen Giac Mo Ngay Cuoi", "ve-nen-giac-mo-ngay-cuoi", "In Love Forever The Series", "/media/the_boys_4k.jpg", "/media/the_boys_4k.jpg", 2026],
  ["U Thi Ly Hon!", "u-thi-ly-hon", "OK! Let's Get Divorced", "/media/spider_man_4k.jpg", "/media/spider_man_4k.jpg", 2026],
].map(([name, slug, origin_name, poster_url, thumb_url, year], index) => {
  const [genres, countries] = PHIM4K_FILTER_METADATA[index] || [[], []];
  return Object.freeze({
  name, slug, origin_name, poster_url, thumb_url, year,
  quality: "FHD", episode_current: "Full", lang: "Vietsub",
  content: "Thong tin chi tiet se duoc cap nhat khi nguon du lieu san sang.",
  category: genres.map((name) => ({ name })),
  country: countries.map((name) => ({ name })),
  });
}));
