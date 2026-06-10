import { pick, rand } from './rng.js';

const FIRST = ['Бран', 'Альдрик', 'Мира', 'Тео', 'Изольда', 'Гарен', 'Лира', 'Одо', 'Винна', 'Седрик',
  'Хильда', 'Рован', 'Эда', 'Фальк', 'Ним', 'Орла', 'Пип', 'Сабля', 'Това', 'Ульф',
  'Весна', 'Врен', 'Йорик', 'Зора', 'Ансель', 'Берил', 'Корин', 'Дара', 'Эдмунд', 'Фия'];
const EPITHET = ['Смелый', 'из Долины', 'Быстроногий', 'Тихоня', 'Железная Рука', 'Приблудный',
  'из Дубравы', 'Длинный Шаг', 'Невезучий', 'Ясноглазый', 'с Мельницы', 'Трёхпалый',
  'Младший', 'Пепельный', 'Упрямый', 'Остроум', 'из Низин', 'Полусапог'];

export function heroName(state) {
  return rand(state) < 0.55 ? `${pick(state, FIRST)} ${pick(state, EPITHET)}` : pick(state, FIRST);
}

// Самое сильное отклонение от классового baseline становится видимым характером героя
export function traitLabel(traits, baseline) {
  const checks = [
    ['courage', -1, 'Трус'], ['courage', +1, 'Храбрец'],
    ['greed', +1, 'Жадина'], ['greed', -1, 'Бессребреник'],
    ['diligence', +1, 'Непоседа'], ['diligence', -1, 'Лентяй'],
  ];
  let best = null, bestDev = 0.08; // отклонение должно быть заметным
  for (const [key, sign, label] of checks) {
    const dev = (traits[key] - baseline[key]) * sign;
    if (dev > bestDev) { bestDev = dev; best = label; }
  }
  if (best) return best;
  // абсолютные крайности как запасной вариант
  if (traits.courage < 0.3) return 'Трус';
  if (traits.greed > 0.8) return 'Жадина';
  if (traits.courage > 0.75) return 'Храбрец';
  return 'Невозмутимый';
}
