import type { AbilityId, Action, BotDifficulty, HeroId, Lang, MapId, ModeId, Quality, RibbonId, Role, WeaponId } from '../game/Types';

// ---------------------------------------------------------------------------
// language state

let lang: Lang = 'ru';
const listeners = new Set<(l: Lang) => void>();

export function setLang(l: Lang): void {
  if (l !== 'ru' && l !== 'en') l = 'ru';
  if (l === lang) return;
  lang = l;
  if (typeof document !== 'undefined') document.documentElement.lang = l;
  for (const f of listeners) f(l);
}

export function getLang(): Lang {
  return lang;
}

/** subscribe to language changes; returns unsubscribe */
export function onLangChange(f: (l: Lang) => void): () => void {
  listeners.add(f);
  return () => listeners.delete(f);
}

// ---------------------------------------------------------------------------
// UI strings

const RU = {
  // generic
  'common.back': 'Назад',
  'common.on': 'Вкл',
  'common.off': 'Выкл',
  'common.yes': 'Да',
  'common.no': 'Нет',
  'common.cancel': 'Отмена',
  'common.close': 'Закрыть',
  'common.esc': 'Esc',
  'common.bot': 'БОТ',
  'common.you': 'Вы',
  'common.min': '{n} мин',
  'common.sec': '{n} с',
  'common.m': '{n} м',
  'team.0': 'ARTEMIS',
  'team.1': 'SELENE',
  'team.0.full': 'ARTEMIS · Лунный корпус',
  'team.1.full': 'SELENE · Горный легион',

  // network / player card
  'net.online': 'Онлайн',
  'net.offline': 'Офлайн',
  'net.checking': 'Связь…',
  'net.offlineHint': 'Сервер лобби недоступен — доступна тренировка с ботами',
  'player.level': 'Ур.',
  'player.xp': '{into} / {need} XP',

  // main
  'nav.play': 'Играть',
  'nav.play.sub': 'Быстрая игра · Тренировка · Серверы',
  'nav.heroes': 'Герои',
  'nav.heroes.sub': 'Шесть бойцов лунной войны',
  'nav.profile': 'Профиль',
  'nav.profile.sub': 'Карьера, награды, история',
  'nav.settings': 'Настройки',
  'nav.settings.sub': 'Графика, звук, управление',
  'nav.credits': 'Авторы',
  'nav.install': 'Установить приложение',
  'main.selectedHero': 'Ваш герой',
  'main.changeHero': 'Сменить героя',
  'main.quick': 'Быстрая игра',
  'main.news': 'Лунная сводка',
  'main.news1.t': 'Сезон 1 · Палладиевая лихорадка',
  'main.news1.d': 'ARTEMIS и SELENE стягивают силы к кратеру Тихо. Запасы Pd-46 решат исход войны.',
  'main.news2.t': 'Капсулы снабжения',
  'main.news2.d': 'С орбиты падают контейнеры с супероружием. Кто первым вскроет — тот и диктует правила.',
  'main.news3.t': 'Берегите скафандр',
  'main.news3.d': 'Пробитый скафандр теряет кислород. Герметик [H] — ваш лучший друг.',
  'main.version': 'Сборка {v}',

  // play
  'play.title': 'Играть',
  'play.tab.modes': 'Режимы',
  'play.tab.servers': 'Серверы',
  'play.quick': 'Быстрая игра',
  'play.quick.sub': 'Онлайн-подбор матча',
  'play.bots': 'Тренировка с ботами',
  'play.bots.sub': 'Офлайн, без подключения',
  'play.create': 'Создать комнату',
  'play.create.sub': 'Приватная ссылка для друзей',
  'play.botDifficulty': 'Сложность ботов',
  'play.hero': 'Герой',
  'play.change': 'Сменить',
  'play.selectMode': 'Выберите режим',
  'play.timeLimit': 'Лимит времени',
  'play.scoreLimit': 'Цель',
  'play.offline': 'Онлайн недоступен',
  'servers.refresh': 'Обновить',
  'servers.all': 'Все',
  'servers.col.name': 'Комната',
  'servers.col.mode': 'Режим',
  'servers.col.map': 'Карта',
  'servers.col.players': 'Игроки',
  'servers.join': 'Войти',
  'servers.full': 'Полная',
  'servers.empty': 'Открытых комнат нет. Создайте свою!',
  'servers.loading': 'Сканируем лунную орбиту…',
  'servers.error': 'Сервер лобби недоступен',
  'servers.errorHint': 'Проверьте подключение или сыграйте с ботами.',
  'servers.paste': 'Вставьте ссылку-приглашение или код комнаты',
  'servers.connect': 'Подключиться',
  'servers.badCode': 'Неверная ссылка или код комнаты',
  'servers.byLink': 'По приглашению',
  'servers.count': 'Комнат: {n}',

  // heroes
  'heroes.title': 'Герои',
  'role.tank': 'Танк',
  'role.support': 'Поддержка',
  'heroes.difficulty': 'Сложность',
  'heroes.health': 'Здоровье',
  'heroes.suit': 'Скафандр',
  'heroes.speed': 'Скорость',
  'heroes.speedVal': '{n} м/с',
  'heroes.weapon': 'Оружие',
  'heroes.abilities': 'Способности',
  'heroes.ult': 'Суперспособность',
  'heroes.passive': 'Снаряжение',
  'heroes.cooldown': '{s} с',
  'heroes.duration': 'длит. {s} с',
  'heroes.charges': '{n} заряда',
  'heroes.ultCost': '{n} ед. заряда',
  'heroes.sealants': 'Наборы герметика: {n}',
  'heroes.select': 'Выбрать',
  'heroes.selected': 'Выбран',
  'heroes.yourStats': 'Ваша статистика',
  'heroes.noStats': 'Вы ещё не играли за этого героя. Самое время начать.',
  'heroes.picked': '{h} — выбран',

  // stats
  'stat.matches': 'Матчи',
  'stat.wins': 'Победы',
  'stat.losses': 'Поражения',
  'stat.winrate': 'Процент побед',
  'stat.kills': 'Устранения',
  'stat.deaths': 'Смерти',
  'stat.assists': 'Помощь',
  'stat.kd': 'У/С',
  'stat.time': 'Время в игре',
  'stat.damage': 'Урон',
  'stat.healing': 'Лечение',
  'stat.accuracy': 'Точность',
  'stat.headshots': 'В голову',
  'stat.hsRate': 'Доля в голову',
  'stat.captures': 'Захваты точек',
  'stat.longestKill': 'Самый дальний',
  'stat.wallKills': 'Устранения со стен',
  'stat.suffocations': 'Враги задохнулись',
  'stat.nukes': 'Ядерные удары',
  'stat.bestStreak': 'Лучшая серия',
  'stat.shots': 'Выстрелы',

  // profile
  'profile.title': 'Профиль',
  'profile.tab.overview': 'Обзор',
  'profile.tab.heroes': 'Герои',
  'profile.tab.history': 'История',
  'profile.tab.ribbons': 'Награды',
  'profile.name': 'Позывной',
  'profile.edit': 'Изменить',
  'profile.save': 'Сохранить',
  'profile.nameSaved': 'Позывной сохранён',
  'profile.nameInvalid': 'Позывной: от 2 до 16 символов',
  'profile.totalXp': 'Всего опыта',
  'profile.nextLevel': 'До уровня {n}: {x} XP',
  'profile.since': 'В строю с {date}',
  'profile.rank': 'Звание',
  'profile.noHistory': 'Сыгранных матчей пока нет. Луна ждёт.',
  'profile.sec.combat': 'Бой',
  'profile.sec.precision': 'Меткость',
  'profile.sec.lunar': 'Лунная война',
  'profile.col.hero': 'Герой',
  'profile.col.time': 'Время',
  'profile.col.date': 'Дата',
  'profile.col.mode': 'Режим',
  'profile.col.result': 'Итог',
  'profile.col.kda': 'У / С / П',
  'profile.col.score': 'Очки',
  'profile.col.xp': 'Опыт',
  'profile.unlocked': 'Получено: {n}',
  'profile.locked': 'Не получено',
  'profile.ribbonsCount': 'Собрано {n} из {m}',
  'profile.favorite': 'Любимый герой',
  'result.win': 'Победа',
  'result.loss': 'Поражение',
  'result.draw': 'Ничья',
  'result.place': '{n}-е место',

  // settings
  'settings.title': 'Настройки',
  'settings.tab.graphics': 'Графика',
  'settings.tab.audio': 'Звук',
  'settings.tab.controls': 'Управление',
  'settings.tab.game': 'Игра',
  'settings.tab.crosshair': 'Прицел',
  'settings.reset': 'Сбросить вкладку',
  'settings.resetDone': 'Настройки вкладки сброшены',
  'settings.group.preset': 'Пресет',
  'settings.group.render': 'Рендеринг',
  'settings.group.effects': 'Эффекты',
  'settings.group.volume': 'Громкость',
  'settings.group.mouse': 'Мышь',
  'settings.group.move': 'Движение',
  'settings.group.combat': 'Бой',
  'settings.group.other': 'Прочее',
  'settings.group.bots': 'Боты',
  'settings.group.hud': 'Интерфейс',
  'settings.group.lang': 'Язык',
  'set.quality': 'Качество графики',
  'set.renderScale': 'Масштаб рендеринга',
  'set.fov': 'Поле зрения',
  'set.outlines': 'Мультяшные контуры',
  'set.ao': 'Фоновое затенение (AO)',
  'set.bloom': 'Свечение (bloom)',
  'set.shadows': 'Тени',
  'set.filmGrain': 'Зернистость плёнки',
  'set.motionBlur': 'Размытие в движении',
  'set.showFps': 'Показывать FPS',
  'set.master': 'Общая громкость',
  'set.sfx': 'Эффекты',
  'set.music': 'Музыка',
  'set.ui': 'Интерфейс',
  'set.sensitivity': 'Чувствительность мыши',
  'set.ads': 'Множитель при прицеливании',
  'set.invertY': 'Инверсия оси Y',
  'set.toggleAim': 'Прицеливание переключением',
  'set.toggleCrouch': 'Присед переключением',
  'set.keys': 'Назначение клавиш',
  'set.resetKeys': 'Клавиши по умолчанию',
  'set.pressKey': 'Нажмите клавишу или кнопку мыши…',
  'set.pressKeyHint': 'Esc — отмена',
  'set.swapped': '«{a}» перенесено на {k}',
  'set.keysReset': 'Клавиши сброшены',
  'set.botDifficulty': 'Сложность ботов',
  'set.hudScale': 'Масштаб HUD',
  'set.hitMarkers': 'Хитмаркеры',
  'set.damageNumbers': 'Числа урона',
  'set.minimapRotate': 'Вращение миникарты',
  'set.language': 'Язык интерфейса',
  'set.ch.style': 'Форма',
  'set.ch.color': 'Цвет',
  'set.ch.size': 'Размер',
  'set.ch.opacity': 'Непрозрачность',
  'set.ch.preview': 'Предпросмотр',
  'set.ch.custom': 'Свой',
  'ch.cross': 'Крест',
  'ch.dot': 'Точка',
  'ch.circle': 'Кольцо',
  'ch.chevron': 'Шеврон',
  'quality.low': 'Низкое',
  'quality.medium': 'Среднее',
  'quality.high': 'Высокое',
  'quality.ultra': 'Ультра',
  'shadows.off': 'Выкл',
  'shadows.low': 'Низкие',
  'shadows.high': 'Высокие',
  'bot.easy': 'Лёгкие',
  'bot.normal': 'Обычные',
  'bot.hard': 'Сложные',
  'bot.veteran': 'Ветераны',
  'setd.quality': 'Пресет одним движением задаёт все технологии: тени, AO, сглаживание, отражения, текстуры, свечение, частицы и масштаб рендеринга.',
  'setd.renderScale': 'Внутреннее разрешение. Меньше — выше FPS, больше — чётче картинка.',
  'setd.fov': 'Угол обзора. Широкий угол помогает видеть фланги, но уменьшает цели.',
  'setd.outlines': 'Фирменные чернильные контуры в стиле комикса вокруг бойцов и построек.',
  'setd.ao': 'Мягкие тени в углах и щелях. Добавляет объёма, стоит производительности.',
  'setd.bloom': 'Сияние палладиевой руды, выстрелов и взрывов.',
  'setd.shadows': 'Качество теней от Солнца. На Луне тени абсолютно чёрные и резкие.',
  'setd.filmGrain': 'Лёгкое кинематографическое зерно поверх изображения.',
  'setd.motionBlur': 'Размытие при быстрых поворотах камеры.',
  'setd.showFps': 'Счётчик кадров и пинга в углу экрана.',
  'setd.sensitivity': 'Скорость поворота камеры мышью.',
  'setd.ads': 'Множитель чувствительности при прицеливании и в оптике.',
  'setd.invertY': 'Движение мыши вверх опускает прицел.',
  'setd.toggleAim': 'Одно нажатие включает прицеливание, повторное — выключает.',
  'setd.toggleCrouch': 'Одно нажатие — присесть, повторное — встать.',
  'setd.hudScale': 'Размер элементов интерфейса в бою.',
  'setd.hitMarkers': 'Отметка у прицела при попадании. Красный крест — устранение.',
  'setd.damageNumbers': 'Всплывающие числа урона над целью.',
  'setd.minimapRotate': 'Миникарта поворачивается вместе с вами. Выкл — север всегда сверху.',
  'setd.botDifficulty': 'Меткость, реакция и тактика ботов в тренировке и на свободных слотах.',
  'setd.language': 'Язык меню, подсказок и интерфейса.',
  'setd.volume': 'Громкость соответствующего канала звука.',
  'setd.keys': 'Нажмите на клавишу, чтобы переназначить действие. При конфликте клавиши меняются местами.',
  'setd.crosshair': 'Настройте прицел под себя: форма, цвет, размер и прозрачность.',

  // actions
  'act.forward': 'Вперёд',
  'act.back': 'Назад',
  'act.left': 'Влево',
  'act.right': 'Вправо',
  'act.jump': 'Прыжок / ранец',
  'act.crouch': 'Присесть',
  'act.fire': 'Огонь',
  'act.aim': 'Прицеливание',
  'act.reload': 'Перезарядка',
  'act.ability1': 'Способность 1',
  'act.ability2': 'Способность 2',
  'act.ultimate': 'Суперспособность',
  'act.weapon1': 'Основное оружие',
  'act.weapon2': 'Супероружие',
  'act.sealant': 'Герметик',
  'act.mag': 'Магнитные ботинки',
  'act.ping': 'Метка',
  'act.interact': 'Взаимодействие',
  'act.view': 'Сменить вид',
  'act.scoreboard': 'Таблица счёта',
  'act.map': 'Карта',
  'act.chat': 'Чат',

  // credits
  'credits.title': 'Авторы',
  'credits.tagline': 'Мультяшный sci-fi шутер о войне за палладий на Луне.',
  'credits.design': 'Геймдизайн и разработка',
  'credits.team': 'Команда MOON GRAVITY',
  'credits.tech': 'Технологии',
  'credits.fonts': 'Шрифты',
  'credits.thanks': 'Спасибо, что сражаетесь за Луну!',

  // loading / matchmaking
  'loading.tip': 'Совет',
  'loading.deploy': 'Высадка',
  'mm.title': 'Поиск матча',
  'mm.elapsed': 'Прошло',
  'mm.cancel': 'Отмена',
  'mm.st.searching': 'Ищем подходящую комнату…',
  'mm.st.searching_again': 'Ищем другую комнату…',
  'mm.st.joining': 'Подключаемся к комнате…',
  'mm.st.joiningTo': 'Подключаемся к «{name}»…',
  'mm.st.connected': 'Соединение установлено!',
  'mm.st.hosting': 'Свободных комнат нет — создаём свою…',
  'mm.st.hosted': 'Комната создана — ждём игроков',

  // hero select
  'hs.title': 'Выберите героя',
  'hs.confirm': 'Подтвердить',
  'hs.allies': 'Ваша команда',
  'hs.time': 'До высадки',
  'hs.hint': 'Enter — подтвердить',
  'hs.hintClose': 'Esc — закрыть',
  'hs.ffa': 'Каждый сам за себя',

  // pause
  'pause.title': 'Меню матча',
  'pause.resume': 'Продолжить',
  'pause.settings': 'Настройки',
  'pause.copyLink': 'Скопировать ссылку',
  'pause.copied': 'Ссылка скопирована в буфер обмена',
  'pause.copyFail': 'Не удалось скопировать — выделите ссылку вручную',
  'pause.leave': 'Покинуть матч',
  'pause.leaveConfirm': 'Точно покинуть матч?',
  'pause.host': 'Вы — хост',
  'pause.hostWarn': 'Если хост выйдет, матч завершится для всех.',
  'pause.players': 'Игроки',
  'pause.invite': 'Пригласите друзей',
  'pause.code': 'Код',

  // end of match
  'end.victory': 'Победа',
  'end.defeat': 'Поражение',
  'end.draw': 'Ничья',
  'end.place': '{n}-е место',
  'end.of': 'из {n}',
  'end.scoreboard': 'Итоги матча',
  'end.xp': 'Опыт',
  'end.total': 'Итого',
  'end.levelUp': 'Новый уровень',
  'end.mastery': 'Мастерство · {h}',
  'end.buildUnlocked': 'Открыт билд «{b}»',
  'end.ribbons': 'Награды матча',
  'end.noRibbons': 'В этот раз без наград. В следующий раз повезёт!',
  'end.continue': 'Продолжить',
  'end.mvp': 'MVP',
  'end.duration': 'Длительность',
  'col.player': 'Боец',
  'col.e': 'Устр.',
  'col.a': 'Пом.',
  'col.d': 'Смерти',
  'col.score': 'Очки',
  'col.damage': 'Урон',
  'col.healing': 'Лечение',
  'col.ping': 'Пинг',

  // HUD
  'hud.breach': 'Разгерметизация',
  'hud.leak': 'утечка O₂ {r}%/с',
  'hud.suffocating': 'Удушье',
  'hud.sealHint': 'герметик',
  'hud.o2': 'O₂',
  'hud.jet': 'Ранец',
  'hud.suit': 'Скафандр',
  'hud.mag.off': 'Маг. выкл',
  'hud.mag.on': 'Маг. вкл',
  'hud.mag.attached': 'Сцепка',
  'hud.mag.emp': 'ЭМИ',
  'hud.ultReady': 'Суперспособность готова',
  'hud.ultReadyShort': 'Готово',
  'hud.reloading': 'Перезарядка',
  'hud.noAmmo': 'Нет патронов',
  'hud.lowAmmo': 'Перезарядка',
  'hud.charge': 'Заряд',
  'hud.eliminatedBy': 'Вас устранил',
  'hud.env.suffocation': 'Вы задохнулись',
  'hud.env.fall': 'Смертельное падение',
  'hud.env.self': 'Самоустранение',
  'hud.respawnIn': 'Возрождение через',
  'hud.respawning': 'Высадка…',
  'hud.changeHero': 'Сменить героя',
  'hud.killerHp': 'Здоровье противника',
  'hud.oob': 'Вернитесь в зону боя',
  'hud.oobSub': 'Скафандр не выдержит — осталось',
  'hud.spectating': 'Наблюдение',
  'hud.contested': 'Оспаривается',
  'hud.capturing': 'Захват',
  'hud.ffa.you': 'Вы',
  'hud.ffa.leader': 'Лидер',
  'hud.ffa.rank': 'Место',
  'hud.chat.placeholder': 'Сообщение… Enter — отправить, Esc — закрыть',
  'hud.super': 'Супероружие',
  'hud.captured': 'Точка {id} захвачена',
  'hud.lost': 'Точка {id} потеряна',
  'hud.enemyCaptured': 'Противник захватил точку {id}',
  'hud.fps': 'FPS',
  'hud.ping': 'Пинг',
  'hud.limit': 'до {n}',
  'hud.sealing': 'Герметизация',
  'hud.invuln': 'Спасательный пузырь',
  'hud.cloaked': 'Маскировка',
  'hud.killed': 'Устранён',
  'hud.headshot': 'В голову',
  'sb.title': 'Таблица счёта',
  'scope.rail': 'РЕЛЬСОТРОН · ЗАРЯД',
  'scope.nuke': '«КАРМАННОЕ СОЛНЦЕ» · ВЗВЕДЕНО',
  'scope.des': 'ОРБИТАЛЬНЫЙ ЛАЗЕР · СОЛНЕЧНОЕ КОПЬЁ',
  'scope.uplink': 'СВЯЗЬ ●',
  'scope.lock': 'ЗАХВАТ ЦЕЛИ',
  'hud.elim': 'Устранён',
  'hud.assist': 'Помощь',
  'hud.suitShort': 'Скаф.',
  'hud.hp': 'Здоровье',
  'hud.super.ammo': 'Заряды',
  'compass': 'С,СВ,В,ЮВ,Ю,ЮЗ,З,СЗ',
  'sb.time': 'Осталось',
  'interact.pod': 'Вскрыть капсулу снабжения',
  'interact.o2': 'Кислородная станция',
  'interact.pickup': 'Подобрать',
  'interact.revive': 'Помочь союзнику',

  // modes/maps extra
  'mode.duel2v2.players': '2 × 2',
  'mode.ffa.players': '8 бойцов',
  'mode.war4v4.players': '4 × 4 + боты',
  'mode.duel2v2.goal': '15 устранений',
  'mode.ffa.goal': '25 устранений',
  'mode.war4v4.goal': '600 очков',
  'mode.teams': 'Командный',
  'mode.solo': 'Одиночный',

  // roles (v2)
  'role.ranged': 'Стрелок',
  'role.melee': 'Ближний бой',
  'role.scout': 'Разведчик',
  'role.engineer': 'Техножрец',
  // builds & mastery
  'build.title': 'Билды',
  'build.select': 'Выбрать билд',
  'build.selected': 'Выбран',
  'build.locked': 'Ур. {n}',
  'build.lockedHint': 'Откроется на {n}-м уровне мастерства',
  'build.picked': 'Билд «{b}» выбран',
  'mastery.title': 'Мастерство',
  'mastery.level': 'Ур. {n}',
  'mastery.xp': '{into} / {need} XP мастерства',
  'mastery.short': 'Мастерство',
  // universal gadgets
  'gadgets.title': 'Общие навыки',
  'gadget.grapple': 'Крюк-кошка',
  'gadget.grapple.d': 'Трос к любой поверхности, воздушные тормоза в полёте.',
  'gadget.melee': 'Удар',
  'gadget.melee.d': 'Быстрый удар прикладом или кулаком.',
  'gadget.prone': 'Лечь',
  'gadget.prone.d': 'Плашмя — меньше силуэт, выше точность.',
  'gadget.roll': 'Перекат',
  'gadget.roll.d': 'Боевой перекат в сторону движения.',
  'gadget.slide': 'Подкат',
  'gadget.slide.d': 'Присесть на бегу — скольжение по реголиту.',
  'gadget.mantle': 'Подъём',
  'gadget.mantle.d': 'Автоматически забирается на уступы.',
  'gadget.jet': 'Ранец',
  'gadget.jet.d': 'Зажмите прыжок в воздухе.',
  'gadget.mag': 'Маг. ботинки',
  'gadget.mag.d': 'Ходьба по металлическим стенам и потолкам.',
  'gadget.sealant': 'Герметик',
  'gadget.sealant.d': 'Латает пробитый скафандр.',
  'gadget.auto': 'авто',
  'gadget.hold': 'удерж.',
  // graphics tiers
  'settings.group.main': 'Основное',
  'settings.group.heavy': 'Тяжёлые — сильно влияют на FPS',
  'settings.group.medium': 'Средние',
  'settings.group.light': 'Лёгкие',
  'perf.heavy': 'Тяжёлая',
  'perf.medium': 'Средняя',
  'perf.light': 'Лёгкая',
  'set.antialias': 'Сглаживание (SMAA)',
  'set.lensFlare': 'Блики объектива',
  'set.particles': 'Частицы',
  'set.textureQuality': 'Качество текстур',
  'set.terrainDetail': 'Детализация грунта',
  'set.reflections': 'Отражения',
  'setd.antialias': 'Постобработка SMAA сглаживает зубчатые края. Заметно нагружает видеокарту.',
  'setd.lensFlare': 'Солнечные блики и засветка, когда вы смотрите на Солнце.',
  'setd.particles': 'Плотность пыли, искр, дыма и осколков.',
  'setd.textureQuality': 'Разрешение процедурных текстур. Применяется со следующего матча.',
  'setd.terrainDetail': 'Мелкие кратеры и камни вблизи.',
  'setd.reflections': 'Отражения окружения на металле и визорах.',
  'setd.restart': 'Применится со следующего матча',
  'lvl.low': 'Низк.',
  'lvl.medium': 'Средн.',
  'lvl.high': 'Высок.',
  // new actions
  'act.grapple': 'Крюк-кошка',
  'act.melee': 'Удар в ближнем бою',
  'act.prone': 'Лечь',
  'act.roll': 'Перекат',
  // HUD extras
  'hud.stance.stand': 'Стоя',
  'hud.stance.crouch': 'Присед',
  'hud.stance.prone': 'Лёжа',
  'hud.stance.slide': 'Подкат',
  'hud.stance.roll': 'Перекат',
  'hud.summons': 'Призывы',
  'hud.ff': 'Поле',
  'mk.turret': 'Турель',
  'mk.shield': 'Щит',
  'mk.station': 'Станция',
  'mk.mine': 'Мина',
  'mk.sensor': 'Датчик',
  'mk.drone': 'Дрон',
  'mk.servitor': 'Сервитор',
  'mk.barricade': 'Баррикада',
  'mk.strike': 'Удар',
  'mk.decoy': 'Приманка',
} as const;

export type StrKey = keyof typeof RU;

const EN: Record<StrKey, string> = {
  'common.back': 'Back',
  'common.on': 'On',
  'common.off': 'Off',
  'common.yes': 'Yes',
  'common.no': 'No',
  'common.cancel': 'Cancel',
  'common.close': 'Close',
  'common.esc': 'Esc',
  'common.bot': 'BOT',
  'common.you': 'You',
  'common.min': '{n} min',
  'common.sec': '{n}s',
  'common.m': '{n} m',
  'team.0': 'ARTEMIS',
  'team.1': 'SELENE',
  'team.0.full': 'ARTEMIS · Lunar Corps',
  'team.1.full': 'SELENE · Mining Legion',

  'net.online': 'Online',
  'net.offline': 'Offline',
  'net.checking': 'Linking…',
  'net.offlineHint': 'Lobby server unavailable — bot training only',
  'player.level': 'Lv.',
  'player.xp': '{into} / {need} XP',

  'nav.play': 'Play',
  'nav.play.sub': 'Quick play · Training · Servers',
  'nav.heroes': 'Heroes',
  'nav.heroes.sub': 'Six fighters of the lunar war',
  'nav.profile': 'Career',
  'nav.profile.sub': 'Stats, ribbons, history',
  'nav.settings': 'Settings',
  'nav.settings.sub': 'Graphics, audio, controls',
  'nav.credits': 'Credits',
  'nav.install': 'Install app',
  'main.selectedHero': 'Your hero',
  'main.changeHero': 'Change hero',
  'main.quick': 'Quick play',
  'main.news': 'Lunar dispatch',
  'main.news1.t': 'Season 1 · Palladium Rush',
  'main.news1.d': 'ARTEMIS and SELENE mass their forces at Tycho crater. Pd-46 reserves will decide the war.',
  'main.news2.t': 'Supply pods',
  'main.news2.d': 'Super-weapon crates rain from orbit. Whoever cracks one open first makes the rules.',
  'main.news3.t': 'Mind your suit',
  'main.news3.d': 'A breached suit leaks oxygen. Sealant [H] is your best friend.',
  'main.version': 'Build {v}',

  'play.title': 'Play',
  'play.tab.modes': 'Modes',
  'play.tab.servers': 'Server browser',
  'play.quick': 'Quick play',
  'play.quick.sub': 'Online matchmaking',
  'play.bots': 'Practice vs bots',
  'play.bots.sub': 'Offline, no connection needed',
  'play.create': 'Create room',
  'play.create.sub': 'Private link for friends',
  'play.botDifficulty': 'Bot difficulty',
  'play.hero': 'Hero',
  'play.change': 'Change',
  'play.selectMode': 'Select a mode',
  'play.timeLimit': 'Time limit',
  'play.scoreLimit': 'Goal',
  'play.offline': 'Online unavailable',
  'servers.refresh': 'Refresh',
  'servers.all': 'All',
  'servers.col.name': 'Room',
  'servers.col.mode': 'Mode',
  'servers.col.map': 'Map',
  'servers.col.players': 'Players',
  'servers.join': 'Join',
  'servers.full': 'Full',
  'servers.empty': 'No open rooms. Host your own!',
  'servers.loading': 'Scanning lunar orbit…',
  'servers.error': 'Lobby server unavailable',
  'servers.errorHint': 'Check your connection or play against bots.',
  'servers.paste': 'Paste an invite link or room code',
  'servers.connect': 'Connect',
  'servers.badCode': 'Invalid room link or code',
  'servers.byLink': 'By invite',
  'servers.count': 'Rooms: {n}',

  'heroes.title': 'Heroes',
  'role.tank': 'Tank',
  'role.support': 'Support',
  'heroes.difficulty': 'Difficulty',
  'heroes.health': 'Health',
  'heroes.suit': 'Suit',
  'heroes.speed': 'Speed',
  'heroes.speedVal': '{n} m/s',
  'heroes.weapon': 'Weapon',
  'heroes.abilities': 'Abilities',
  'heroes.ult': 'Ultimate',
  'heroes.passive': 'Kit',
  'heroes.cooldown': '{s}s',
  'heroes.duration': '{s}s duration',
  'heroes.charges': '{n} charges',
  'heroes.ultCost': '{n} charge pts',
  'heroes.sealants': 'Sealant kits: {n}',
  'heroes.select': 'Select',
  'heroes.selected': 'Selected',
  'heroes.yourStats': 'Your stats',
  'heroes.noStats': "You haven't played this hero yet. Time to start.",
  'heroes.picked': '{h} selected',

  'stat.matches': 'Matches',
  'stat.wins': 'Wins',
  'stat.losses': 'Losses',
  'stat.winrate': 'Win rate',
  'stat.kills': 'Eliminations',
  'stat.deaths': 'Deaths',
  'stat.assists': 'Assists',
  'stat.kd': 'K/D',
  'stat.time': 'Time played',
  'stat.damage': 'Damage',
  'stat.healing': 'Healing',
  'stat.accuracy': 'Accuracy',
  'stat.headshots': 'Headshots',
  'stat.hsRate': 'Headshot rate',
  'stat.captures': 'Point captures',
  'stat.longestKill': 'Longest kill',
  'stat.wallKills': 'Wall-walk kills',
  'stat.suffocations': 'Enemies suffocated',
  'stat.nukes': 'Nukes launched',
  'stat.bestStreak': 'Best streak',
  'stat.shots': 'Shots fired',

  'profile.title': 'Career',
  'profile.tab.overview': 'Overview',
  'profile.tab.heroes': 'Heroes',
  'profile.tab.history': 'History',
  'profile.tab.ribbons': 'Ribbons',
  'profile.name': 'Callsign',
  'profile.edit': 'Edit',
  'profile.save': 'Save',
  'profile.nameSaved': 'Callsign saved',
  'profile.nameInvalid': 'Callsign must be 2–16 characters',
  'profile.totalXp': 'Total XP',
  'profile.nextLevel': 'To level {n}: {x} XP',
  'profile.since': 'Enlisted {date}',
  'profile.rank': 'Rank',
  'profile.noHistory': 'No matches played yet. The Moon awaits.',
  'profile.sec.combat': 'Combat',
  'profile.sec.precision': 'Precision',
  'profile.sec.lunar': 'Lunar warfare',
  'profile.col.hero': 'Hero',
  'profile.col.time': 'Time',
  'profile.col.date': 'Date',
  'profile.col.mode': 'Mode',
  'profile.col.result': 'Result',
  'profile.col.kda': 'E / D / A',
  'profile.col.score': 'Score',
  'profile.col.xp': 'XP',
  'profile.unlocked': 'Earned: {n}',
  'profile.locked': 'Locked',
  'profile.ribbonsCount': '{n} of {m} collected',
  'profile.favorite': 'Favourite hero',
  'result.win': 'Victory',
  'result.loss': 'Defeat',
  'result.draw': 'Draw',
  'result.place': '#{n}',

  'settings.title': 'Settings',
  'settings.tab.graphics': 'Graphics',
  'settings.tab.audio': 'Audio',
  'settings.tab.controls': 'Controls',
  'settings.tab.game': 'Gameplay',
  'settings.tab.crosshair': 'Crosshair',
  'settings.reset': 'Reset tab',
  'settings.resetDone': 'Tab restored to defaults',
  'settings.group.preset': 'Preset',
  'settings.group.render': 'Rendering',
  'settings.group.effects': 'Effects',
  'settings.group.volume': 'Volume',
  'settings.group.mouse': 'Mouse',
  'settings.group.move': 'Movement',
  'settings.group.combat': 'Combat',
  'settings.group.other': 'Other',
  'settings.group.bots': 'Bots',
  'settings.group.hud': 'HUD',
  'settings.group.lang': 'Language',
  'set.quality': 'Graphics quality',
  'set.renderScale': 'Render scale',
  'set.fov': 'Field of view',
  'set.outlines': 'Cartoon outlines',
  'set.ao': 'Ambient occlusion',
  'set.bloom': 'Bloom',
  'set.shadows': 'Shadows',
  'set.filmGrain': 'Film grain',
  'set.motionBlur': 'Motion blur',
  'set.showFps': 'Show FPS',
  'set.master': 'Master volume',
  'set.sfx': 'Effects',
  'set.music': 'Music',
  'set.ui': 'Interface',
  'set.sensitivity': 'Mouse sensitivity',
  'set.ads': 'ADS sensitivity multiplier',
  'set.invertY': 'Invert Y axis',
  'set.toggleAim': 'Toggle aim',
  'set.toggleCrouch': 'Toggle crouch',
  'set.keys': 'Key bindings',
  'set.resetKeys': 'Default bindings',
  'set.pressKey': 'Press a key or mouse button…',
  'set.pressKeyHint': 'Esc to cancel',
  'set.swapped': '"{a}" moved to {k}',
  'set.keysReset': 'Bindings restored',
  'set.botDifficulty': 'Bot difficulty',
  'set.hudScale': 'HUD scale',
  'set.hitMarkers': 'Hit markers',
  'set.damageNumbers': 'Damage numbers',
  'set.minimapRotate': 'Rotate minimap',
  'set.language': 'Interface language',
  'set.ch.style': 'Shape',
  'set.ch.color': 'Colour',
  'set.ch.size': 'Size',
  'set.ch.opacity': 'Opacity',
  'set.ch.preview': 'Preview',
  'set.ch.custom': 'Custom',
  'ch.cross': 'Cross',
  'ch.dot': 'Dot',
  'ch.circle': 'Circle',
  'ch.chevron': 'Chevron',
  'quality.low': 'Low',
  'quality.medium': 'Medium',
  'quality.high': 'High',
  'quality.ultra': 'Ultra',
  'shadows.off': 'Off',
  'shadows.low': 'Low',
  'shadows.high': 'High',
  'bot.easy': 'Easy',
  'bot.normal': 'Normal',
  'bot.hard': 'Hard',
  'bot.veteran': 'Veteran',
  'setd.quality': 'One-click preset for every technology: shadows, AO, anti-aliasing, reflections, textures, bloom, particles and render scale.',
  'setd.renderScale': 'Internal resolution. Lower for more FPS, higher for a sharper image.',
  'setd.fov': 'Viewing angle. Wider shows more of your flanks but makes targets smaller.',
  'setd.outlines': 'Signature comic-book ink outlines around fighters and structures.',
  'setd.ao': 'Soft contact shadows in corners and crevices. Adds depth, costs performance.',
  'setd.bloom': 'Glow of palladium ore, muzzle flashes and explosions.',
  'setd.shadows': 'Sun shadow quality. Lunar shadows are pitch-black and razor sharp.',
  'setd.filmGrain': 'Subtle cinematic grain over the image.',
  'setd.motionBlur': 'Blur during fast camera turns.',
  'setd.showFps': 'Frame rate and ping counter in the corner.',
  'setd.sensitivity': 'Camera turn speed with the mouse.',
  'setd.ads': 'Sensitivity multiplier while aiming down sights or scoped.',
  'setd.invertY': 'Moving the mouse up aims down.',
  'setd.toggleAim': 'Press once to aim, again to stop.',
  'setd.toggleCrouch': 'Press once to crouch, again to stand up.',
  'setd.hudScale': 'Size of in-game HUD elements.',
  'setd.hitMarkers': 'Marker at the crosshair on hit. Red cross means elimination.',
  'setd.damageNumbers': 'Floating damage numbers over your target.',
  'setd.minimapRotate': 'The minimap turns with you. Off keeps north up.',
  'setd.botDifficulty': 'Aim, reaction and tactics of bots in training and in empty slots.',
  'setd.language': 'Language of menus, tips and HUD.',
  'setd.volume': 'Volume of this audio channel.',
  'setd.keys': 'Click a key to rebind an action. Conflicting keys are swapped.',
  'setd.crosshair': 'Make the crosshair yours: shape, colour, size and opacity.',

  'act.forward': 'Forward',
  'act.back': 'Back',
  'act.left': 'Left',
  'act.right': 'Right',
  'act.jump': 'Jump / jetpack',
  'act.crouch': 'Crouch',
  'act.fire': 'Fire',
  'act.aim': 'Aim',
  'act.reload': 'Reload',
  'act.ability1': 'Ability 1',
  'act.ability2': 'Ability 2',
  'act.ultimate': 'Ultimate',
  'act.weapon1': 'Primary weapon',
  'act.weapon2': 'Super weapon',
  'act.sealant': 'Sealant',
  'act.mag': 'Magnetic boots',
  'act.ping': 'Ping',
  'act.interact': 'Interact',
  'act.view': 'Toggle view',
  'act.scoreboard': 'Scoreboard',
  'act.map': 'Map',
  'act.chat': 'Chat',

  'credits.title': 'Credits',
  'credits.tagline': 'A cartoon sci-fi shooter about the war for palladium on the Moon.',
  'credits.design': 'Game design & development',
  'credits.team': 'The MOON GRAVITY team',
  'credits.tech': 'Technology',
  'credits.fonts': 'Fonts',
  'credits.thanks': 'Thank you for fighting for the Moon!',

  'loading.tip': 'Tip',
  'loading.deploy': 'Deploying',
  'mm.title': 'Finding match',
  'mm.elapsed': 'Elapsed',
  'mm.cancel': 'Cancel',
  'mm.st.searching': 'Looking for a room…',
  'mm.st.searching_again': 'Trying another room…',
  'mm.st.joining': 'Joining room…',
  'mm.st.joiningTo': 'Joining "{name}"…',
  'mm.st.connected': 'Connected!',
  'mm.st.hosting': 'No open rooms — hosting a new one…',
  'mm.st.hosted': 'Room created — waiting for players',

  'hs.title': 'Choose your hero',
  'hs.confirm': 'Confirm',
  'hs.allies': 'Your team',
  'hs.time': 'Deploy in',
  'hs.hint': 'Enter — confirm',
  'hs.hintClose': 'Esc — close',
  'hs.ffa': 'Free-for-all',

  'pause.title': 'Match menu',
  'pause.resume': 'Resume',
  'pause.settings': 'Settings',
  'pause.copyLink': 'Copy invite link',
  'pause.copied': 'Invite link copied to clipboard',
  'pause.copyFail': 'Could not copy — select the link manually',
  'pause.leave': 'Leave match',
  'pause.leaveConfirm': 'Really leave the match?',
  'pause.host': 'You are the host',
  'pause.hostWarn': 'If the host leaves, the match ends for everyone.',
  'pause.players': 'Players',
  'pause.invite': 'Invite friends',
  'pause.code': 'Code',

  'end.victory': 'Victory',
  'end.defeat': 'Defeat',
  'end.draw': 'Draw',
  'end.place': '#{n}',
  'end.of': 'of {n}',
  'end.scoreboard': 'Match summary',
  'end.xp': 'Experience',
  'end.total': 'Total',
  'end.levelUp': 'Level up',
  'end.mastery': 'Mastery · {h}',
  'end.buildUnlocked': 'Build unlocked: {b}',
  'end.ribbons': 'Match ribbons',
  'end.noRibbons': 'No ribbons this time. Better luck next drop!',
  'end.continue': 'Continue',
  'end.mvp': 'MVP',
  'end.duration': 'Duration',
  'col.player': 'Fighter',
  'col.e': 'Elims',
  'col.a': 'Assists',
  'col.d': 'Deaths',
  'col.score': 'Score',
  'col.damage': 'Damage',
  'col.healing': 'Healing',
  'col.ping': 'Ping',

  'hud.breach': 'Suit breach',
  'hud.leak': 'O₂ leak {r}%/s',
  'hud.suffocating': 'Suffocating',
  'hud.sealHint': 'sealant',
  'hud.o2': 'O₂',
  'hud.jet': 'Jet',
  'hud.suit': 'Suit',
  'hud.mag.off': 'Mag off',
  'hud.mag.on': 'Mag on',
  'hud.mag.attached': 'Locked',
  'hud.mag.emp': 'EMP',
  'hud.ultReady': 'Ultimate ready',
  'hud.ultReadyShort': 'Ready',
  'hud.reloading': 'Reloading',
  'hud.noAmmo': 'No ammo',
  'hud.lowAmmo': 'Reload',
  'hud.charge': 'Charge',
  'hud.eliminatedBy': 'Eliminated by',
  'hud.env.suffocation': 'You suffocated',
  'hud.env.fall': 'Fatal fall',
  'hud.env.self': 'Self-eliminated',
  'hud.respawnIn': 'Respawn in',
  'hud.respawning': 'Deploying…',
  'hud.changeHero': 'Change hero',
  'hud.killerHp': 'Killer health',
  'hud.oob': 'Return to the combat zone',
  'hud.oobSub': 'Suit failure in',
  'hud.spectating': 'Spectating',
  'hud.contested': 'Contested',
  'hud.capturing': 'Capturing',
  'hud.ffa.you': 'You',
  'hud.ffa.leader': 'Leader',
  'hud.ffa.rank': 'Rank',
  'hud.chat.placeholder': 'Message… Enter to send, Esc to close',
  'hud.super': 'Super weapon',
  'hud.captured': 'Point {id} captured',
  'hud.lost': 'Point {id} lost',
  'hud.enemyCaptured': 'Enemy captured point {id}',
  'hud.fps': 'FPS',
  'hud.ping': 'Ping',
  'hud.limit': 'to {n}',
  'hud.sealing': 'Sealing',
  'hud.invuln': 'Life bubble',
  'hud.cloaked': 'Cloaked',
  'hud.killed': 'Eliminated',
  'hud.headshot': 'Headshot',
  'sb.title': 'Scoreboard',
  'scope.rail': 'RAILGUN · CHARGE',
  'scope.nuke': '"POCKET SUN" · ARMED',
  'scope.des': 'ORBITAL LASER · SUNSPEAR',
  'scope.uplink': 'UPLINK ●',
  'scope.lock': 'TARGET LOCK',
  'hud.elim': 'Eliminated',
  'hud.assist': 'Assist',
  'hud.suitShort': 'Suit',
  'hud.hp': 'Health',
  'hud.super.ammo': 'Charges',
  'compass': 'N,NE,E,SE,S,SW,W,NW',
  'sb.time': 'Time left',
  'interact.pod': 'Open supply pod',
  'interact.o2': 'Oxygen station',
  'interact.pickup': 'Pick up',
  'interact.revive': 'Help teammate',

  'mode.duel2v2.players': '2 × 2',
  'mode.ffa.players': '8 fighters',
  'mode.war4v4.players': '4 × 4 + bots',
  'mode.duel2v2.goal': '15 eliminations',
  'mode.ffa.goal': '25 eliminations',
  'mode.war4v4.goal': '600 points',
  'mode.teams': 'Team',
  'mode.solo': 'Solo',

  'role.ranged': 'Ranged',
  'role.melee': 'Melee',
  'role.scout': 'Scout',
  'role.engineer': 'Tech-priest',
  'build.title': 'Builds',
  'build.select': 'Select build',
  'build.selected': 'Selected',
  'build.locked': 'Lv. {n}',
  'build.lockedHint': 'Unlocks at mastery level {n}',
  'build.picked': 'Build "{b}" selected',
  'mastery.title': 'Mastery',
  'mastery.level': 'Lv. {n}',
  'mastery.xp': '{into} / {need} mastery XP',
  'mastery.short': 'Mastery',
  'gadgets.title': 'Universal skills',
  'gadget.grapple': 'Grappling hook',
  'gadget.grapple.d': 'A tether to any surface, with air brakes mid-flight.',
  'gadget.melee': 'Melee',
  'gadget.melee.d': 'A quick rifle-butt or fist strike.',
  'gadget.prone': 'Prone',
  'gadget.prone.d': 'Go flat — smaller silhouette, better accuracy.',
  'gadget.roll': 'Combat roll',
  'gadget.roll.d': 'A tactical roll in your movement direction.',
  'gadget.slide': 'Slide',
  'gadget.slide.d': 'Crouch while running to slide across the regolith.',
  'gadget.mantle': 'Mantle',
  'gadget.mantle.d': 'Automatically climbs ledges.',
  'gadget.jet': 'Jetpack',
  'gadget.jet.d': 'Hold jump in the air.',
  'gadget.mag': 'Mag-boots',
  'gadget.mag.d': 'Walk on metal walls and ceilings.',
  'gadget.sealant': 'Sealant',
  'gadget.sealant.d': 'Patches a breached suit.',
  'gadget.auto': 'auto',
  'gadget.hold': 'hold',
  'settings.group.main': 'General',
  'settings.group.heavy': 'Heavy — big FPS impact',
  'settings.group.medium': 'Medium',
  'settings.group.light': 'Light',
  'perf.heavy': 'Heavy',
  'perf.medium': 'Medium',
  'perf.light': 'Light',
  'set.antialias': 'Anti-aliasing (SMAA)',
  'set.lensFlare': 'Lens flare',
  'set.particles': 'Particles',
  'set.textureQuality': 'Texture quality',
  'set.terrainDetail': 'Terrain detail',
  'set.reflections': 'Reflections',
  'setd.antialias': 'SMAA post-processing smooths jagged edges. Noticeable GPU cost.',
  'setd.lensFlare': 'Sun glare and flares when you look toward the Sun.',
  'setd.particles': 'Density of dust, sparks, smoke and debris.',
  'setd.textureQuality': 'Procedural texture resolution. Applies from the next match.',
  'setd.terrainDetail': 'Micro craters and pebbles up close.',
  'setd.reflections': 'Environment reflections on metal and visors.',
  'setd.restart': 'Applies from the next match',
  'lvl.low': 'Low',
  'lvl.medium': 'Med',
  'lvl.high': 'High',
  'act.grapple': 'Grappling hook',
  'act.melee': 'Quick melee',
  'act.prone': 'Prone',
  'act.roll': 'Combat roll',
  'hud.stance.stand': 'Standing',
  'hud.stance.crouch': 'Crouched',
  'hud.stance.prone': 'Prone',
  'hud.stance.slide': 'Sliding',
  'hud.stance.roll': 'Rolling',
  'hud.summons': 'Summons',
  'hud.ff': 'Field',
  'mk.turret': 'Turret',
  'mk.shield': 'Shield',
  'mk.station': 'Station',
  'mk.mine': 'Mine',
  'mk.sensor': 'Sensor',
  'mk.drone': 'Drone',
  'mk.servitor': 'Servitor',
  'mk.barricade': 'Barricade',
  'mk.strike': 'Strike',
  'mk.decoy': 'Decoy',
};

export function t(key: string, vars?: Record<string, string | number>): string {
  const d = lang === 'en' ? EN : (RU as Record<string, string>);
  let s = (d as Record<string, string>)[key] ?? (RU as Record<string, string>)[key] ?? key;
  if (vars) for (const k in vars) s = s.split('{' + k + '}').join(String(vars[k]));
  return s;
}

type Bi = { ru: string; en: string };
const pick = (b: Bi): string => (lang === 'en' ? b.en : b.ru);

/** pick the current-language string from a {ru, en} pair (e.g. BuildDef.name) */
export function bi(b: Bi | undefined | null): string {
  return b ? pick(b) : '';
}

// ---------------------------------------------------------------------------
// heroes

interface HeroCopy {
  name: Bi;
  callsign: Bi;
  tagline: Bi;
  bio: Bi;
}

const HERO_COPY: Record<HeroId, HeroCopy> = {
  condor: {
    name: { ru: 'Кондор', en: 'Condor' },
    callsign: { ru: 'Даниэль Рейес', en: 'Daniel Reyes' },
    tagline: { ru: 'Первым входит — последним уходит.', en: 'First in, last out.' },
    bio: {
      ru: 'Штурмовик орбитального десанта и ветеран высадки на Шеклтон-3. Импульсная винтовка, реактивный рывок и привычка шутить в эфире, когда вокруг всё горит.',
      en: 'Orbital drop trooper and veteran of the Shackleton-3 landing. A pulse rifle, a jet dash and a habit of cracking jokes on comms while everything burns.',
    },
  },
  needle: {
    name: { ru: 'Игла', en: 'Needle' },
    callsign: { ru: 'Ирина Соколова', en: 'Irina Sokolova' },
    tagline: { ru: 'Один выстрел. Одна пробоина.', en: 'One shot. One breach.' },
    bio: {
      ru: 'Бывший геодезист карьера, которая попадает рельсотроном в заклёпку с двух километров. Голографические приманки сбивают врага с толку, а датчики движения не дают никому подкрасться.',
      en: 'Former quarry surveyor who can hit a rivet with a railgun from two kilometres. Holographic decoys confuse the enemy, and motion sensors keep anyone from sneaking up.',
    },
  },
  lunatic: {
    name: { ru: 'Лунатик', en: 'Lunatic' },
    callsign: { ru: 'Бруно Кесслер', en: 'Bruno Kessler' },
    tagline: { ru: 'Взрывотехник с лицензией на Солнце.', en: 'Demolitions expert licensed to carry a sun.' },
    bio: {
      ru: 'Годами рвал породу в палладиевой шахте, пока не понял, что по людям тоже работает. Гранаты по лунной дуге, ракетные прыжки и тактический ядерный заряд в рюкзаке.',
      en: 'Blasted rock in the palladium mines for years until he found it works on people too. Lunar-arc grenades, rocket jumps and a tactical nuke in his backpack.',
    },
  },
  phantom: {
    name: { ru: 'Фантом', en: 'Phantom' },
    callsign: { ru: 'Мира Вэйл', en: 'Mira Vale' },
    tagline: { ru: 'Её не видно. В вакууме — тем более.', en: 'Unseen. Unheard. Especially in a vacuum.' },
    bio: {
      ru: 'Бывший диверсант SELENE, работающая теперь на того, кто платит палладием. Два дуговых ПП, скачки сквозь пространство и ЭМИ-нова, которая сбрасывает врагов со стен.',
      en: 'Ex-SELENE saboteur who now works for whoever pays in palladium. Twin arc SMGs, blinks through space and an EMP nova that tears enemies off the walls.',
    },
  },
  reactor: {
    name: { ru: 'Реактор', en: 'Reactor' },
    callsign: { ru: 'Гектор Бранко', en: 'Hector Branco' },
    tagline: { ru: 'Ходячий термоядерный щит.', en: 'A walking fusion bulwark.' },
    bio: {
      ru: 'Оператор бурового реактора из шахты Тихо. Весит как луноход и держит удар как купол базы. Разворачивает щит, бьёт магнитом о грунт и зажигает чёрную дыру там, где стоял враг.',
      en: 'Drill-reactor operator from the Tycho mine. Heavy as a rover and as tough as a base dome. Deploys shields, magnet-slams the ground and ignites a black hole where the enemy stood.',
    },
  },
  blade: {
    name: { ru: 'Клинок', en: 'Blade' },
    callsign: { ru: 'Кай Мурата', en: 'Kai Murata' },
    tagline: { ru: 'Свет режет вакуум.', en: 'Light cuts through the void.' },
    bio: {
      ru: 'Бывший оператор горного лазерного резака, перековавший его в плазменную катану. Врывается выпадом, отражает пули клинком, а в ярости обрушивает на врагов волны лунного света.',
      en: 'A former mining-laser cutter operator who reforged his tool into a plasma katana. Lunges in, deflects bullets with the blade and, when enraged, unleashes waves of moonlight.',
    },
  },
  forge: {
    name: { ru: 'Кузня', en: 'Forge' },
    callsign: { ru: 'Магистр Лука Ферр', en: 'Magister Luka Ferr' },
    tagline: { ru: 'Машина помнит. Машина служит.', en: 'The machine remembers. The machine serves.' },
    bio: {
      ru: 'Техножрец горной гильдии, для которого каждый болт — молитва. Собирает из лома боевых сервиторов, ставит автотурели и окутывает союзников силовыми полями, способными выдержать ракету.',
      en: 'A tech-priest of the mining guild for whom every bolt is a prayer. Builds combat servitors from scrap, deploys auto-turrets and wraps allies in force fields that can take a rocket.',
    },
  },
  hive: {
    name: { ru: 'Улей', en: 'Hive' },
    callsign: { ru: 'Юна Ким', en: 'Yuna Kim' },
    tagline: { ru: 'Я никогда не прихожу одна.', en: 'I never come alone.' },
    bio: {
      ru: 'Оператор дронов из службы разведки карьера. Дрон-охотник преследует цели, дрон-наводчик подсвечивает врагов команде, а рой камикадзе превращает любую позицию в фейерверк.',
      en: 'A drone operator from the quarry recon service. Her hunter drone chases targets, the spotter marks enemies for the team, and a kamikaze swarm turns any position into fireworks.',
    },
  },
  helios: {
    name: { ru: 'Гелиос', en: 'Helios' },
    callsign: { ru: 'Ада Нкеми', en: 'Ada Nkemi' },
    tagline: { ru: 'Пока я дышу — дышите и вы.', en: 'While I breathe, so do you.' },
    bio: {
      ru: 'Полевой медик и инженер систем жизнеобеспечения. Её пена лечит раны и латает скафандры, кислородный выброс спасает от удушья, а спасательный пузырь делает команду неуязвимой.',
      en: 'Field medic and life-support engineer. Her foam heals wounds and patches suits, her O₂ burst saves the suffocating, and her life bubble makes the whole team untouchable.',
    },
  },
};

export function heroName(id: HeroId): string {
  return HERO_COPY[id] ? pick(HERO_COPY[id].name) : id;
}
export function heroCallsign(id: HeroId): string {
  return HERO_COPY[id] ? pick(HERO_COPY[id].callsign) : '';
}
export function heroTagline(id: HeroId): string {
  return HERO_COPY[id] ? pick(HERO_COPY[id].tagline) : '';
}
export function heroBio(id: HeroId): string {
  return HERO_COPY[id] ? pick(HERO_COPY[id].bio) : '';
}

export function roleName(r: Role): string {
  return t('role.' + r);
}

// ---------------------------------------------------------------------------
// abilities

const ABILITY_COPY: Record<AbilityId, { name: Bi; desc: Bi }> = {
  dash: {
    name: { ru: 'Реактивный рывок', en: 'Jet Dash' },
    desc: { ru: 'Резкий рывок ранцем в направлении движения. Работает и в прыжке.', en: 'A burst of jet thrust in your movement direction. Works mid-air too.' },
  },
  frag: {
    name: { ru: 'Осколочная граната', en: 'Frag Grenade' },
    desc: { ru: 'Граната с коротким запалом. Осколки рвут скафандры и вызывают утечку кислорода.', en: 'Short-fuse grenade. Shrapnel shreds suits and starts oxygen leaks.' },
  },
  swarm: {
    name: { ru: 'Рой микроракет', en: 'Micro-Missile Swarm' },
    desc: { ru: 'Залп самонаводящихся микроракет по всем врагам в поле зрения.', en: 'Unleash a volley of homing micro-missiles at every enemy in sight.' },
  },
  decoy: {
    name: { ru: 'Голо-приманка', en: 'Holo Decoy' },
    desc: { ru: 'Голографическая копия отвлекает огонь и создаёт ложную отметку на вражеском радаре.', en: 'A holographic double that draws fire and fakes a blip on enemy radar.' },
  },
  lunge: {
    name: { ru: 'Выпад', en: 'Lunge' },
    desc: { ru: 'Стремительный рывок с ударом клинка по первой цели на пути.', en: 'A blazing dash that slashes the first target in your path.' },
  },
  deflect: {
    name: { ru: 'Отражение', en: 'Deflect' },
    desc: { ru: 'Клинок отражает снаряды обратно и блокирует выстрелы спереди.', en: 'Your blade reflects projectiles and blocks incoming fire from the front.' },
  },
  moonblade: {
    name: { ru: 'Лунный клинок', en: 'Moonblade' },
    desc: { ru: 'Клинок заряжается энергией: каждый взмах выпускает режущую волну.', en: 'Your blade surges with energy: every swing launches a cutting wave.' },
  },
  servitor: {
    name: { ru: 'Сервитор', en: 'Servitor' },
    desc: { ru: 'Призывает боевого робота-сервитора, который сражается рядом с вами.', en: 'Summons a humanoid combat servitor that fights at your side.' },
  },
  turret: {
    name: { ru: 'Автотурель', en: 'Auto-Turret' },
    desc: { ru: 'Турель сама обстреливает врагов в зоне видимости.', en: 'A turret that automatically fires at enemies in sight.' },
  },
  forcefield: {
    name: { ru: 'Силовое поле', en: 'Force Field' },
    desc: { ru: 'Модули поля на союзниках рядом: щит выдерживает даже ракету.', en: 'Field modules on nearby allies: the shield can take even a rocket.' },
  },
  barricade: {
    name: { ru: 'Баррикада', en: 'Barricade' },
    desc: { ru: 'Разворачивает стену-укрытие, которая останавливает пули.', en: 'Deploys a cover wall that stops bullets.' },
  },
  huntdrone: {
    name: { ru: 'Дрон-охотник', en: 'Hunter Drone' },
    desc: { ru: 'Вооружённый дрон преследует и атакует ближайших врагов.', en: 'An armed drone that hunts down and attacks nearby enemies.' },
  },
  spotdrone: {
    name: { ru: 'Дрон-наводчик', en: 'Spotter Drone' },
    desc: { ru: 'Дрон кружит над зоной и отмечает врагов для всей команды.', en: 'A drone that circles the area and marks enemies for your team.' },
  },
  kamikaze: {
    name: { ru: 'Рой камикадзе', en: 'Kamikaze Swarm' },
    desc: { ru: 'Стая дронов-камикадзе находит врагов и взрывается.', en: 'A swarm of kamikaze drones seeks out enemies and detonates.' },
  },
  grapple: {
    name: { ru: 'Крюк-кошка', en: 'Grappling Hook' },
    desc: { ru: 'Трос притягивает к любой поверхности. В полёте работают воздушные тормоза.', en: 'A tether that pulls you to any surface. Air brakes work mid-flight.' },
  },
  sensor: {
    name: { ru: 'Датчик движения', en: 'Motion Sensor' },
    desc: { ru: 'Бросаемый датчик подсвечивает движущихся врагов для всей команды.', en: 'A thrown sensor that reveals moving enemies to your whole team.' },
  },
  overcharge: {
    name: { ru: 'Перегрузка', en: 'Overcharge' },
    desc: { ru: 'Рельсотрон заряжается мгновенно, а выстрелы пробивают стены.', en: 'Your railgun charges instantly and every shot pierces walls.' },
  },
  dome: {
    name: { ru: 'Щитовой купол', en: 'Shield Dome' },
    desc: { ru: 'Купол из силового поля задерживает выстрелы снаружи.', en: 'A force-field dome that stops incoming fire.' },
  },
  slam: {
    name: { ru: 'Магнитный удар', en: 'Mag Slam' },
    desc: { ru: 'Удар о грунт отбрасывает врагов и срывает их с магнитных стен.', en: 'Slam the ground to blast enemies away and rip them off magnetic walls.' },
  },
  blackhole: {
    name: { ru: 'Сингулярность', en: 'Singularity' },
    desc: { ru: 'Сфера чёрной дыры стягивает врагов к центру и сминает их.', en: 'A black-hole orb that drags enemies to its core and crushes them.' },
  },
  o2burst: {
    name: { ru: 'Кислородный выброс', en: 'O₂ Burst' },
    desc: { ru: 'Волна вокруг вас лечит, восполняет кислород и латает скафандры союзников.', en: 'A wave that heals, refills oxygen and patches nearby allies’ suits.' },
  },
  medstation: {
    name: { ru: 'Медстанция', en: 'Med Station' },
    desc: { ru: 'Станция лечит и подаёт кислород союзникам поблизости.', en: 'A station that heals and feeds oxygen to nearby allies.' },
  },
  lifebubble: {
    name: { ru: 'Спасательный пузырь', en: 'Life Bubble' },
    desc: { ru: 'Воздушный пузырь делает всю команду рядом неуязвимой.', en: 'An air bubble that makes your nearby team invulnerable.' },
  },
  rocketjump: {
    name: { ru: 'Ракетный прыжок', en: 'Rocket Jump' },
    desc: { ru: 'Взрыв под ногами подбрасывает вас — при лунной гравитации очень высоко.', en: 'A blast under your boots launches you — very high in lunar gravity.' },
  },
  mine: {
    name: { ru: 'Мина-липучка', en: 'Proximity Mine' },
    desc: { ru: 'Магнитная мина крепится к любой поверхности и взрывается рядом с врагом.', en: 'A magnetic mine that sticks to any surface and detonates near enemies.' },
  },
  tacnuke: {
    name: { ru: 'Тактический ядерный удар', en: 'Tactical Nuke' },
    desc: { ru: 'Запуск ядерной ракеты. В радиусе взрыва не выживает никто. Ищите укрытие!', en: 'Launch a nuclear rocket. Nobody survives inside the blast radius. Take cover!' },
  },
  blink: {
    name: { ru: 'Скачок', en: 'Blink' },
    desc: { ru: 'Мгновенный телепорт на короткую дистанцию.', en: 'Instantly teleport a short distance.' },
  },
  cloak: {
    name: { ru: 'Маскировка', en: 'Cloak' },
    desc: { ru: 'Невидимость. Атака снимает маскировку.', en: 'Turn invisible. Attacking breaks the cloak.' },
  },
  empnova: {
    name: { ru: 'ЭМИ-нова', en: 'EMP Nova' },
    desc: { ru: 'Импульс сбрасывает врагов со стен, глушит ранцы, магнитные ботинки и способности.', en: 'A pulse that drops enemies off walls and kills their jetpacks, mag-boots and abilities.' },
  },
};

export function abilityName(id: AbilityId): string {
  return ABILITY_COPY[id] ? pick(ABILITY_COPY[id].name) : id;
}
export function abilityDesc(id: AbilityId): string {
  return ABILITY_COPY[id] ? pick(ABILITY_COPY[id].desc) : '';
}

// ---------------------------------------------------------------------------
// weapons

const WEAPON_COPY: Record<WeaponId, { name: Bi; short: Bi; desc: Bi }> = {
  pulse: {
    name: { ru: 'Импульсная винтовка «Кондор»', en: 'Condor Pulse Rifle' },
    short: { ru: 'Импульсная винтовка', en: 'Pulse Rifle' },
    desc: { ru: 'Надёжный автомат с точной стрельбой очередями.', en: 'A reliable automatic rifle with accurate bursts.' },
  },
  rail: {
    name: { ru: 'Рельсотрон «Игла»', en: 'Needle Railgun' },
    short: { ru: 'Рельсотрон', en: 'Railgun' },
    desc: { ru: 'Заряжаемый выстрел гиперзвуковым стержнем. Пробивает скафандры навылет.', en: 'Charged hypersonic slug. Punches straight through suits.' },
  },
  plasma: {
    name: { ru: 'Плазменный дробовик «Сверхновая»', en: 'Supernova Plasma Shotgun' },
    short: { ru: 'Плазменный дробовик', en: 'Plasma Shotgun' },
    desc: { ru: 'Веер плазменных сгустков в упор. Разговор короткий.', en: 'A point-blank fan of plasma. Short conversations.' },
  },
  glauncher: {
    name: { ru: 'Гранатомёт «Лунатик»', en: 'Lunatic Grenade Launcher' },
    short: { ru: 'Гранатомёт', en: 'Grenade Launcher' },
    desc: { ru: 'Гранаты летят по пологой лунной дуге и отскакивают от стен.', en: 'Grenades fly on a lazy lunar arc and bounce off walls.' },
  },
  sealer: {
    name: { ru: 'Пенный излучатель «Гелиос»', en: 'Helios Foam Projector' },
    short: { ru: 'Пенный излучатель', en: 'Foam Projector' },
    desc: { ru: 'Лечебная пена лечит союзников и латает пробитые скафандры.', en: 'Healing foam that mends allies and patches breached suits.' },
  },
  twinarc: {
    name: { ru: 'Дуговые ПП «Искры»', en: 'Sparks Twin Arc SMGs' },
    short: { ru: 'Дуговые ПП', en: 'Twin Arc SMGs' },
    desc: { ru: 'Пара скорострельных пистолетов-пулемётов с электрической дугой.', en: 'A pair of rapid-fire SMGs spitting electric arcs.' },
  },
  blade: {
    name: { ru: 'Плазменная катана «Серп»', en: '"Sickle" Plasma Katana' },
    short: { ru: 'Плазменная катана', en: 'Plasma Katana' },
    desc: { ru: 'Клинок из перекованного горного резака. Режет броню и скафандры.', en: 'A blade reforged from a mining cutter. Slices armour and suits alike.' },
  },
  riveter: {
    name: { ru: 'Клепальщик «Молот»', en: '"Hammer" Riveter' },
    short: { ru: 'Клепальщик', en: 'Riveter' },
    desc: { ru: 'Раскалённые заклёпки летят по дуге и прибивают врагов к стенам.', en: 'Red-hot rivets fly on an arc and nail enemies to walls.' },
  },
  burst: {
    name: { ru: 'Винтовка «Трель»', en: '"Trill" Burst Rifle' },
    short: { ru: 'Винтовка очередями', en: 'Burst Rifle' },
    desc: { ru: 'Точная очередь по три выстрела. Идеальна для работы в паре с дронами.', en: 'Precise three-round bursts. Perfect alongside your drones.' },
  },
  nuke: {
    name: { ru: 'ТЯР «Карманное солнце»', en: '"Pocket Sun" Tactical Nuke' },
    short: { ru: 'Карманное солнце', en: 'Pocket Sun' },
    desc: { ru: 'Переносной тактический ядерный реактивный снаряд. Один выстрел — одна новая звезда.', en: 'Man-portable tactical nuclear rocket. One shot, one new star.' },
  },
  singularity: {
    name: { ru: 'Пушка «Сингулярность»', en: 'Singularity Cannon' },
    short: { ru: 'Сингулярность', en: 'Singularity' },
    desc: { ru: 'Стреляет микроскопической чёрной дырой, которая пожирает всё рядом.', en: 'Fires a microscopic black hole that devours everything nearby.' },
  },
  helios: {
    name: { ru: 'Орбитальный лазер «Солнечное копьё»', en: 'Sunspear Orbital Laser' },
    short: { ru: 'Солнечное копьё', en: 'Sunspear' },
    desc: { ru: 'Целеуказатель наводит луч орбитального лазера на отмеченную точку.', en: 'A designator that calls an orbital laser beam onto the marked spot.' },
  },
};

export function weaponName(id: WeaponId): string {
  return WEAPON_COPY[id] ? pick(WEAPON_COPY[id].name) : id;
}
export function weaponShort(id: WeaponId): string {
  return WEAPON_COPY[id] ? pick(WEAPON_COPY[id].short) : id;
}
export function weaponDesc(id: WeaponId): string {
  return WEAPON_COPY[id] ? pick(WEAPON_COPY[id].desc) : '';
}

// ---------------------------------------------------------------------------
// modes & maps

const MODE_COPY: Record<ModeId, { name: Bi; desc: Bi }> = {
  duel2v2: {
    name: { ru: '2 на 2', en: '2 vs 2' },
    desc: {
      ru: 'Две пары бойцов в тесном бою над малым карьером. Под мостом можно пройти вниз головой.',
      en: 'Two pairs of fighters in a tight brawl over a small open pit. Walk under the bridge upside-down.',
    },
  },
  ffa: {
    name: { ru: 'Каждый сам за себя', en: 'Free-for-All' },
    desc: {
      ru: 'Восемь бойцов в огромном террасном карьере. Мосты над бездной, фабрика и силосы.',
      en: 'Eight fighters in a huge terraced pit. Bridges over the abyss, a refinery and silos.',
    },
  },
  war4v4: {
    name: { ru: '4 на 4 — Захват', en: '4 vs 4 — Conquest' },
    desc: {
      ru: 'Базы ARTEMIS и SELENE. Удерживайте точки A — фабрику, B — буровую в шахте, C — рудные силосы.',
      en: 'ARTEMIS vs SELENE bases. Hold A — the refinery, B — the drill rig in the mine, C — the ore silos.',
    },
  },
};

const MAP_COPY: Record<MapId, { name: Bi; desc: Bi }> = {
  duel: {
    name: { ru: 'Шахта-7', en: 'Mine-7' },
    desc: { ru: 'Компактные аванпосты над открытой выработкой.', en: 'Compact outposts over an open-pit dig.' },
  },
  quarry: {
    name: { ru: 'Палладиевый карьер', en: 'Palladium Quarry' },
    desc: { ru: 'Гигантские террасы, мосты, обогатительная фабрика.', en: 'Giant terraces, bridges and a refinery.' },
  },
  front: {
    name: { ru: 'Фронт Тихо', en: 'Tycho Front' },
    desc: { ru: 'Две укреплённые базы и шахта между ними.', en: 'Two fortified bases and the mine between them.' },
  },
};

export function modeName(id: ModeId): string {
  return MODE_COPY[id] ? pick(MODE_COPY[id].name) : id;
}
export function modeDesc(id: ModeId): string {
  return MODE_COPY[id] ? pick(MODE_COPY[id].desc) : '';
}
export function mapName(id: MapId): string {
  return MAP_COPY[id] ? pick(MAP_COPY[id].name) : id;
}
export function mapDesc(id: MapId): string {
  return MAP_COPY[id] ? pick(MAP_COPY[id].desc) : '';
}

// ---------------------------------------------------------------------------
// ribbons

const RIBBON_COPY: Record<RibbonId, { name: Bi; desc: Bi }> = {
  ace: { name: { ru: 'Ас', en: 'Ace' }, desc: { ru: 'Больше всех очков в матче', en: 'Top score of the match' } },
  killstreak5: { name: { ru: 'Серия ×5', en: 'Streak ×5' }, desc: { ru: '5 устранений без единой смерти', en: '5 eliminations without dying' } },
  killstreak10: { name: { ru: 'Серия ×10', en: 'Streak ×10' }, desc: { ru: '10 устранений без единой смерти', en: '10 eliminations without dying' } },
  headhunter: { name: { ru: 'Охотник за головами', en: 'Headhunter' }, desc: { ru: '5 попаданий в голову за матч', en: '5 headshot kills in one match' } },
  nuclear: { name: { ru: 'Ядерный клуб', en: 'Nuclear Club' }, desc: { ru: 'Устранение ядерным ударом', en: 'Eliminate an enemy with a nuke' } },
  ceiling: { name: { ru: 'Вверх ногами', en: 'Upside Down' }, desc: { ru: 'Устранение со стены или потолка', en: 'Eliminate while walking on a wall or ceiling' } },
  breach: { name: { ru: 'Пробоина', en: 'Breach' }, desc: { ru: 'Враг задохнулся после вашего урона', en: 'An enemy suffocated after your damage' } },
  capture: { name: { ru: 'Захватчик', en: 'Conqueror' }, desc: { ru: '3 захвата точек за матч', en: '3 point captures in one match' } },
  medic: { name: { ru: 'Ангел-хранитель', en: 'Guardian Angel' }, desc: { ru: '1000 лечения или 5 залатанных скафандров', en: 'Heal 1000 HP or patch 5 suits' } },
  ult: { name: { ru: 'Абсолют', en: 'Absolute' }, desc: { ru: '3 устранения одной суперспособностью', en: '3 eliminations with one ultimate' } },
  survivor: { name: { ru: 'Неуязвимый', en: 'Untouchable' }, desc: { ru: 'Победа без единой смерти', en: 'Win without dying' } },
  multikill: { name: { ru: 'Мультикилл', en: 'Multikill' }, desc: { ru: '3 устранения за 4 секунды', en: '3 eliminations within 4 seconds' } },
};

export const RIBBON_ORDER: RibbonId[] = ['ace', 'multikill', 'killstreak5', 'killstreak10', 'headhunter', 'ult', 'nuclear', 'ceiling', 'breach', 'capture', 'medic', 'survivor'];

export function ribbonName(id: RibbonId): string {
  return RIBBON_COPY[id] ? pick(RIBBON_COPY[id].name) : id;
}
export function ribbonDesc(id: RibbonId): string {
  return RIBBON_COPY[id] ? pick(RIBBON_COPY[id].desc) : '';
}

// ---------------------------------------------------------------------------
// misc labels

export function actionName(a: Action): string {
  return t('act.' + a);
}
export function qualityName(q: Quality): string {
  return t('quality.' + q);
}
export function botName(b: BotDifficulty): string {
  return t('bot.' + b);
}

const KEY_NAMES: Record<string, Bi> = {
  Mouse0: { ru: 'ЛКМ', en: 'LMB' },
  Mouse1: { ru: 'СКМ', en: 'MMB' },
  Mouse2: { ru: 'ПКМ', en: 'RMB' },
  Mouse3: { ru: 'М4', en: 'M4' },
  Mouse4: { ru: 'М5', en: 'M5' },
  Space: { ru: 'Пробел', en: 'Space' },
  ShiftLeft: { ru: 'Shift', en: 'Shift' },
  ShiftRight: { ru: 'П.Shift', en: 'R.Shift' },
  ControlLeft: { ru: 'Ctrl', en: 'Ctrl' },
  ControlRight: { ru: 'П.Ctrl', en: 'R.Ctrl' },
  AltLeft: { ru: 'Alt', en: 'Alt' },
  AltRight: { ru: 'П.Alt', en: 'R.Alt' },
  MetaLeft: { ru: 'Win', en: 'Win' },
  Enter: { ru: 'Enter', en: 'Enter' },
  NumpadEnter: { ru: 'Num Enter', en: 'Num Enter' },
  Escape: { ru: 'Esc', en: 'Esc' },
  Backspace: { ru: '⌫', en: '⌫' },
  CapsLock: { ru: 'Caps', en: 'Caps' },
  Tab: { ru: 'Tab', en: 'Tab' },
  ArrowUp: { ru: '↑', en: '↑' },
  ArrowDown: { ru: '↓', en: '↓' },
  ArrowLeft: { ru: '←', en: '←' },
  ArrowRight: { ru: '→', en: '→' },
  Backquote: { ru: '`', en: '`' },
  Minus: { ru: '-', en: '-' },
  Equal: { ru: '=', en: '=' },
  BracketLeft: { ru: '[', en: '[' },
  BracketRight: { ru: ']', en: ']' },
  Semicolon: { ru: ';', en: ';' },
  Quote: { ru: "'", en: "'" },
  Comma: { ru: ',', en: ',' },
  Period: { ru: '.', en: '.' },
  Slash: { ru: '/', en: '/' },
  Backslash: { ru: '\\', en: '\\' },
  Delete: { ru: 'Del', en: 'Del' },
  Insert: { ru: 'Ins', en: 'Ins' },
  Home: { ru: 'Home', en: 'Home' },
  End: { ru: 'End', en: 'End' },
  PageUp: { ru: 'PgUp', en: 'PgUp' },
  PageDown: { ru: 'PgDn', en: 'PgDn' },
};

/** human-readable label for a KeyboardEvent.code / 'MouseN' */
export function keyLabel(code: string): string {
  if (!code) return '—';
  const k = KEY_NAMES[code];
  if (k) return pick(k);
  if (code.startsWith('Key')) return code.slice(3);
  if (code.startsWith('Digit')) return code.slice(5);
  if (code.startsWith('Numpad')) return 'Num' + code.slice(6);
  if (code.startsWith('Mouse')) return 'M' + (Number(code.slice(5)) + 1);
  return code;
}

// ---------------------------------------------------------------------------
// loading-screen tips

const TIPS: Bi[] = [
  { ru: 'Гравитация Луны — 1,62 м/с². Прыжки высокие и медленные, а в воздухе вы — лёгкая мишень.', en: 'Lunar gravity is 1.62 m/s². Jumps are high and slow — and mid-air you are an easy target.' },
  { ru: 'Магнитные ботинки [F] позволяют ходить по металлическим стенам, фасадам и даже потолкам.', en: 'Magnetic boots [F] let you walk on metal walls, facades and even ceilings.' },
  { ru: 'Если скафандр повреждён больше чем наполовину, начинается утечка кислорода. Латайте его герметиком [H].', en: 'Once your suit is more than half damaged it starts leaking oxygen. Patch it with sealant [H].' },
  { ru: 'Кислородные станции на базах восполняют O₂ и чинят скафандр.', en: 'Oxygen stations at the bases refill O₂ and repair your suit.' },
  { ru: 'Капсулы снабжения падают с орбиты. Внутри может оказаться «Карманное солнце».', en: 'Supply pods drop from orbit. You might find a "Pocket Sun" inside.' },
  { ru: 'ЭМИ-нова Фантома сбрасывает всех со стен и глушит ранцы. Не висите под потолком, когда она рядом.', en: "Phantom's EMP nova drops everyone off walls and kills jetpacks. Don't hang from ceilings when she's near." },
  { ru: 'Топливо ранца восстанавливается, пока вы стоите на поверхности.', en: 'Jet fuel regenerates while you stand on a surface.' },
  { ru: 'Под мостом на Шахте-7 можно пройти вниз головой — отличный путь для засады.', en: 'On Mine-7 you can walk under the bridge upside-down — a perfect ambush route.' },
  { ru: 'Рельсотрон рвёт скафандры: даже если противник выжил, он может задохнуться.', en: 'The railgun tears suits apart: even if the target survives, it may suffocate.' },
  { ru: 'Спасательный пузырь Гелиос спасает даже от ядерного удара.', en: "Helios' Life Bubble protects even from a nuclear blast." },
  { ru: 'Палладий (Pd, элемент 46) — главное богатство Луны. Именно из-за него идёт война.', en: 'Palladium (Pd, element 46) is the Moon’s greatest treasure. It is why this war is fought.' },
  { ru: 'В вакууме звук глухой — следите за индикаторами урона вокруг прицела.', en: 'Sound is muffled in a vacuum — watch the damage indicators around your crosshair.' },
  { ru: 'Удушье не мгновенно: у вас есть несколько секунд, чтобы найти станцию или союзника с пеной.', en: 'Suffocation is not instant: you have a few seconds to find a station or a foam-wielding ally.' },
  { ru: 'Точка B лежит на дне шахты. Сверху её удобно простреливать, а спускаться — опасно.', en: 'Point B sits at the bottom of the mine: easy to shoot into from above, dangerous to descend.' },
  { ru: 'Гранаты Лунатика летят по пологой лунной дуге — цельтесь ниже, чем привыкли.', en: "Lunatic's grenades fly on a lazy lunar arc — aim lower than you're used to." },
  { ru: 'Крюк-кошка [G] есть у всех бойцов. В полёте зажмите его, чтобы включить воздушные тормоза.', en: 'Every fighter carries a grappling hook [G]. Hold it mid-flight to engage the air brakes.' },
  { ru: 'Сервиторы Кузни отвлекают огонь на себя — уничтожайте их первыми или обходите.', en: "Forge's servitors draw fire — take them out first or flank them." },
  { ru: 'Отражение Клинка возвращает ракеты. Не стреляйте в него, когда он светится.', en: "Blade's Deflect sends rockets back. Don't shoot him while he glows." },
];

export function tipCount(): number {
  return TIPS.length;
}
export function tip(i: number): string {
  return pick(TIPS[((i % TIPS.length) + TIPS.length) % TIPS.length]);
}

export function fmtDate(ts: number): string {
  try {
    return new Date(ts).toLocaleDateString(lang === 'ru' ? 'ru-RU' : 'en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
  } catch {
    return new Date(ts).toISOString().slice(0, 10);
  }
}

export function fmtDateTime(ts: number): string {
  try {
    return new Date(ts).toLocaleString(lang === 'ru' ? 'ru-RU' : 'en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
  } catch {
    return new Date(ts).toISOString().slice(0, 16).replace('T', ' ');
  }
}
