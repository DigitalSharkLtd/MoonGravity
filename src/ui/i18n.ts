import type { AbilityId, Action, BotDifficulty, HeroId, Lang, MapId, ModeId, PassiveId, Quality, RibbonId, Role, RolePassiveId, WeaponId } from '../game/Types';

// ---------------------------------------------------------------------------
// language state

let lang: Lang = 'en';
const listeners = new Set<(l: Lang) => void>();

export function setLang(l: Lang): void {
  if (l !== 'ru' && l !== 'en') l = 'en';
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
  'net.checking': 'Подключение…',
  'net.offlineHint': 'Сервер лобби недоступен — только тренировка с ботами',
  'player.level': 'Ур.',
  'player.xp': '{into} / {need} XP',

  // main
  'nav.play': 'Играть',
  'nav.play.sub': 'Быстрая игра · Тренировка · Серверы',
  'nav.heroes': 'Герои',
  'nav.heroes.sub': 'Девять бойцов лунной войны',
  'nav.profile': 'Профиль',
  'nav.profile.sub': 'Статистика, награды, история',
  'nav.settings': 'Настройки',
  'nav.settings.sub': 'Графика, звук, управление',
  'nav.credits': 'Авторы',
  'nav.install': 'Установить приложение',
  'nav.fullscreen': 'Полный экран · F10',
  'pause.fullscreen': 'Полный экран',
  'pause.windowed': 'Выйти из полного экрана',
  'nav.windowed': 'Выйти из полного экрана · F10',
  'main.selectedHero': 'Ваш герой',
  'main.changeHero': 'Сменить героя',
  'main.quick': 'Быстрая игра',
  'main.news': 'Лунная сводка',
  'main.news1.t': 'Сезон 1 · Палладиевая лихорадка',
  'main.news1.d': 'ARTEMIS и SELENE стягивают силы к кратеру Тихо. Запасы Pd-46 решат исход войны.',
  'main.news2.t': 'Капсулы снабжения',
  'main.news2.d': 'С орбиты падают капсулы с супероружием. Кто первым вскроет — тот и диктует правила.',
  'main.news3.t': 'Берегите скафандр',
  'main.news3.d': 'Пробитый скафандр теряет кислород. Герметик [H] — ваш лучший друг.',
  'main.version': 'Сборка {v}',

  // play
  'play.title': 'Играть',
  'play.tab.modes': 'Режимы',
  'play.tab.servers': 'Серверы',
  'play.quick': 'Быстрая игра',
  'play.quick.sub': 'Поиск онлайн-матча',
  'play.bots': 'Тренировка с ботами',
  'play.bots.sub': 'Офлайн, без подключения',
  'play.create': 'Создать комнату',
  'play.create.sub': 'Ссылка-приглашение для друзей',
  'play.botDifficulty': 'Сложность ботов',
  'play.hero': 'Герой',
  'play.change': 'Сменить',
  'play.selectMode': 'Выберите режим',
  'play.timeLimit': 'Лимит времени',
  'play.scoreLimit': 'Цель',
  'play.offline': 'Сетевая игра недоступна',
  'servers.refresh': 'Обновить',
  'servers.all': 'Все',
  'servers.col.name': 'Комната',
  'servers.col.mode': 'Режим',
  'servers.col.map': 'Карта',
  'servers.col.players': 'Игроки',
  'servers.join': 'Войти',
  'servers.full': 'Заполнена',
  'servers.empty': 'Открытых комнат нет. Создайте свою!',
  'servers.loading': 'Сканируем лунную орбиту…',
  'servers.error': 'Сервер лобби недоступен',
  'servers.errorHint': 'Проверьте подключение или потренируйтесь с ботами.',
  'servers.paste': 'Вставьте ссылку-приглашение или код комнаты',
  'servers.connect': 'Подключиться',
  'servers.badCode': 'Неверная ссылка или код комнаты',
  'servers.byLink': 'Вход по приглашению',
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
  'heroes.duration': 'действует {s} с',
  'heroes.charges': 'зарядов: {n}',
  'heroes.ultCost': '{n} очков заряда',
  'heroes.sealants': 'Наборов герметика: {n}',
  'heroes.signature': 'Пассивный навык',
  'heroes.rolePerk': 'Бонус роли',
  'heroes.skill': 'Навык оружия',
  'heroes.select': 'Выбрать',
  'heroes.selected': 'Выбран',
  'heroes.yourStats': 'Ваша статистика',
  'heroes.noStats': 'Вы ещё не играли за этого героя. Самое время начать.',
  'heroes.picked': 'Выбран герой: {h}',

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
  'stat.hsRate': '% в голову',
  'stat.captures': 'Захваты точек',
  'stat.longestKill': 'Рекордная дистанция',
  'stat.wallKills': 'Устранения со стен',
  'stat.suffocations': 'Задохнувшиеся враги',
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
  'set.toggleAim': 'Прицеливание нажатием',
  'set.fullscreen': 'Автоматический полный экран',
  'set.toggleCrouch': 'Приседание нажатием',
  'set.keys': 'Назначение клавиш',
  'set.resetKeys': 'Сбросить клавиши',
  'set.pressKey': 'Нажмите клавишу или кнопку мыши…',
  'set.pressKeyHint': 'Esc — отмена',
  'set.swapped': '«{a}» перенесено на {k}',
  'set.keysReset': 'Клавиши сброшены',
  'set.botDifficulty': 'Сложность ботов',
  'set.hudScale': 'Масштаб интерфейса',
  'set.hitMarkers': 'Маркеры попаданий',
  'set.damageNumbers': 'Цифры урона',
  'set.minimapRotate': 'Вращение миникарты',
  'set.language': 'Язык интерфейса',
  'set.ch.style': 'Форма',
  'set.ch.color': 'Цвет',
  'set.ch.size': 'Размер',
  'set.ch.opacity': 'Непрозрачность',
  'set.ch.preview': 'Предпросмотр',
  'set.ch.custom': 'Свой цвет',
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
  'setd.quality': 'Пресет задаёт сразу все параметры: тени, AO, сглаживание, отражения, текстуры, свечение, частицы и масштаб рендеринга.',
  'setd.renderScale': 'Внутреннее разрешение. Меньше — выше FPS, больше — чётче картинка.',
  'setd.fov': 'Угол обзора. Широкий угол открывает фланги, но цели становятся мельче.',
  'setd.outlines': 'Фирменные чернильные контуры в стиле комикса вокруг бойцов и построек.',
  'setd.ao': 'Мягкие тени в углах и щелях. Добавляет объёма, но снижает FPS.',
  'setd.bloom': 'Сияние палладиевой руды, выстрелов и взрывов.',
  'setd.shadows': 'Качество теней от Солнца. На Луне тени абсолютно чёрные и резкие.',
  'setd.filmGrain': 'Лёгкое кинематографическое зерно поверх изображения.',
  'setd.motionBlur': 'Размытие при быстрых поворотах камеры.',
  'setd.showFps': 'Счётчик FPS и пинга в углу экрана.',
  'setd.sensitivity': 'Скорость поворота камеры мышью.',
  'setd.ads': 'Множитель чувствительности мыши при прицеливании.',
  'setd.invertY': 'Движение мыши вверх опускает прицел.',
  'setd.toggleAim': 'Одно нажатие включает прицеливание, повторное — выключает.',
  'setd.fullscreen': 'Игра переходит в полноэкранный режим при первом клике или нажатии клавиши, а также при входе в матч. F10 — включить или выключить полный экран в любой момент, Esc — пауза.',
  'setd.toggleCrouch': 'Одно нажатие — присесть, повторное — встать.',
  'setd.hudScale': 'Размер элементов интерфейса в бою.',
  'setd.hitMarkers': 'Отметка у прицела при попадании. Красный крест — устранение.',
  'setd.damageNumbers': 'Всплывающие цифры урона над целью.',
  'setd.minimapRotate': 'Миникарта поворачивается вместе с вами. Выкл — север всегда сверху.',
  'setd.botDifficulty': 'Меткость, реакция и тактика ботов в тренировке и на свободных местах в матче.',
  'setd.language': 'Язык меню, подсказок и интерфейса.',
  'setd.volume': 'Громкость этого звукового канала.',
  'setd.keys': 'Нажмите на клавишу, чтобы переназначить действие. При конфликте клавиши меняются местами.',
  'setd.crosshair': 'Настройте прицел под себя: форма, цвет, размер и прозрачность.',

  // actions
  'act.forward': 'Вперёд',
  'act.back': 'Назад',
  'act.left': 'Влево',
  'act.right': 'Вправо',
  'act.jump': 'Прыжок (зажать — ранец)',
  'act.sprint': 'Бег',
  'act.crouch': 'Присесть / подкат',
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
  'act.interact': 'Взаимодействие / смена героя',
  'act.view': 'Вид от третьего лица',
  'act.scoreboard': 'Таблица счёта',
  'act.map': 'Карта',
  'act.chat': 'Чат',

  // credits
  'credits.title': 'Авторы',
  'credits.tagline': 'Мультяшный фантастический шутер о войне за лунный палладий.',
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
  'mm.st.connected': 'Подключено!',
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
  'pause.leaveConfirm': 'Выйти из матча?',
  'pause.host': 'Вы — хост',
  'pause.hostWarn': 'Вы хост: если выйдете, матч завершится для всех.',
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
  'end.noRibbons': 'На этот раз без наград. Повезёт в следующем бою!',
  'end.continue': 'Продолжить',
  'end.mvp': 'MVP',
  'end.duration': 'Длительность',
  'col.player': 'Игрок',
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
  'hud.lowAmmo': 'Перезарядить',
  'hud.charge': 'Заряд',
  'hud.heat': 'Нагрев',
  'hud.alt': 'Навык',
  'hud.eliminatedBy': 'Вас устранил',
  'hud.env.suffocation': 'Вы задохнулись',
  'hud.env.fall': 'Смертельное падение',
  'hud.env.self': 'Вы устранили себя',
  'hud.respawnIn': 'Возрождение через',
  'hud.respawning': 'Высадка…',
  'hud.changeHero': 'Сменить героя',
  'hud.killerHp': 'Здоровье противника',
  'hud.oob': 'Вернитесь в зону боя',
  'hud.oobSub': 'Отказ скафандра через',
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
  'hud.killed': 'Вас устранили',
  'hud.headshot': 'В голову',
  'sb.title': 'Таблица счёта',
  'scope.rail': 'РЕЛЬСОТРОН · ЗАРЯД',
  'scope.nuke': '«КАРМАННОЕ СОЛНЦЕ» · ВЗВЕДЕНО',
  'scope.des': 'ОРБИТАЛЬНЫЙ ЛАЗЕР · СОЛНЕЧНОЕ КОПЬЁ',
  'scope.uplink': 'СВЯЗЬ ●',
  'scope.lock': 'ЗАХВАТ ЦЕЛИ',
  'hud.elim': 'Устранение',
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
  'mode.duel2v2.players': '2 на 2',
  'mode.ffa.players': '8 бойцов',
  'mode.war4v4.players': '4 на 4 + боты',
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
  'build.picked': 'Выбран билд «{b}»',
  'mastery.title': 'Мастерство',
  'mastery.level': 'Ур. {n}',
  'mastery.xp': '{into} / {need} XP мастерства',
  'mastery.short': 'Мастерство',
  // universal gadgets
  'gadgets.title': 'Базовый набор',
  'gadget.grapple': 'Крюк-кошка',
  'gadget.grapple.d': 'Притягивает к любой поверхности и тормозит у цели. Перезарядка 18 с.',
  'gadget.melee': 'Быстрый удар',
  'gadget.melee.d': 'Удар прикладом или кулаком.',
  'gadget.prone': 'Лечь',
  'gadget.prone.d': 'Лёжа — меньше силуэт, выше точность.',
  'gadget.roll': 'Перекат',
  'gadget.roll.d': 'Быстрый перекат в сторону движения.',
  'gadget.slide': 'Подкат',
  'gadget.slide.d': 'Пригнитесь на бегу, чтобы проскользить по реголиту.',
  'gadget.mantle': 'Подъём',
  'gadget.mantle.d': 'Боец сам забирается на уступы.',
  'gadget.jet': 'Ранец',
  'gadget.jet.d': 'Зажмите прыжок на полсекунды.',
  'gadget.mag': 'Маг. ботинки',
  'gadget.mag.d': 'Включите, чтобы ходить по металлическим стенам и потолкам.',
  'gadget.sealant': 'Герметик',
  'gadget.sealant.d': 'Латает пробитый скафандр.',
  'gadget.auto': 'авто',
  'gadget.hold': 'зажать',
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
  'setd.antialias': 'SMAA сглаживает «лесенку» на краях объектов. Заметно нагружает видеокарту.',
  'setd.lensFlare': 'Блики и засветка, когда вы смотрите на Солнце.',
  'setd.particles': 'Плотность пыли, искр, дыма и осколков.',
  'setd.textureQuality': 'Разрешение процедурных текстур. Вступит в силу в следующем матче.',
  'setd.terrainDetail': 'Мелкие кратеры и камни вблизи.',
  'setd.reflections': 'Отражения окружения на металле и визорах.',
  'setd.restart': 'Вступит в силу в следующем матче',
  'lvl.low': 'Низк.',
  'lvl.medium': 'Средн.',
  'lvl.high': 'Высок.',
  // new actions
  'act.grapple': 'Крюк-кошка',
  'act.melee': 'Быстрый удар',
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
  'net.checking': 'Connecting…',
  'net.offlineHint': 'Lobby server unavailable — training vs bots only',
  'player.level': 'Lv.',
  'player.xp': '{into} / {need} XP',

  'nav.play': 'Play',
  'nav.play.sub': 'Quick play · Training · Servers',
  'nav.heroes': 'Heroes',
  'nav.heroes.sub': 'Nine fighters of the lunar war',
  'nav.profile': 'Career',
  'nav.profile.sub': 'Stats, ribbons, history',
  'nav.settings': 'Settings',
  'nav.settings.sub': 'Graphics, audio, controls',
  'nav.credits': 'Credits',
  'nav.install': 'Install app',
  'nav.fullscreen': 'Full screen · F10',
  'pause.fullscreen': 'Full screen',
  'pause.windowed': 'Exit full screen',
  'nav.windowed': 'Exit full screen · F10',
  'main.selectedHero': 'Your hero',
  'main.changeHero': 'Change hero',
  'main.quick': 'Quick play',
  'main.news': 'Lunar dispatch',
  'main.news1.t': 'Season 1 · Palladium Rush',
  'main.news1.d': 'ARTEMIS and SELENE are massing forces at Tycho crater. Whoever controls the Pd-46 wins the war.',
  'main.news2.t': 'Supply pods',
  'main.news2.d': 'Super weapons rain from orbit in supply pods. Crack one open first and you make the rules.',
  'main.news3.t': 'Mind your suit',
  'main.news3.d': 'A breached suit leaks oxygen. Sealant [H] is your best friend.',
  'main.version': 'Build {v}',

  'play.title': 'Play',
  'play.tab.modes': 'Modes',
  'play.tab.servers': 'Server browser',
  'play.quick': 'Quick play',
  'play.quick.sub': 'Online matchmaking',
  'play.bots': 'Training vs bots',
  'play.bots.sub': 'Offline, no connection needed',
  'play.create': 'Create room',
  'play.create.sub': 'Invite link for friends',
  'play.botDifficulty': 'Bot difficulty',
  'play.hero': 'Hero',
  'play.change': 'Change',
  'play.selectMode': 'Select a mode',
  'play.timeLimit': 'Time limit',
  'play.scoreLimit': 'Goal',
  'play.offline': 'Online play unavailable',
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
  'servers.byLink': 'Join by invite',
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
  'heroes.passive': 'Gear',
  'heroes.cooldown': '{s}s',
  'heroes.duration': '{s}s duration',
  'heroes.charges': '{n} charges',
  'heroes.ultCost': '{n} pts to charge',
  'heroes.sealants': 'Sealant kits: {n}',
  'heroes.signature': 'Passive',
  'heroes.rolePerk': 'Role perk',
  'heroes.skill': 'Weapon skill',
  'heroes.select': 'Select',
  'heroes.selected': 'Selected',
  'heroes.yourStats': 'Your stats',
  'heroes.noStats': "You haven't played this hero yet. Time to try them out.",
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
  'profile.nextLevel': '{x} XP to level {n}',
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
  'profile.col.kda': 'K / D / A',
  'profile.col.score': 'Score',
  'profile.col.xp': 'XP',
  'profile.unlocked': 'Earned: {n}',
  'profile.locked': 'Locked',
  'profile.ribbonsCount': '{n} of {m} collected',
  'profile.favorite': 'Favorite hero',
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
  'settings.resetDone': 'Tab reset to defaults',
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
  'set.fullscreen': 'Automatic full screen',
  'set.toggleCrouch': 'Toggle crouch',
  'set.keys': 'Key bindings',
  'set.resetKeys': 'Reset bindings',
  'set.pressKey': 'Press a key or mouse button…',
  'set.pressKeyHint': 'Esc to cancel',
  'set.swapped': '“{a}” moved to {k}',
  'set.keysReset': 'Default bindings restored',
  'set.botDifficulty': 'Bot difficulty',
  'set.hudScale': 'HUD scale',
  'set.hitMarkers': 'Hit markers',
  'set.damageNumbers': 'Damage numbers',
  'set.minimapRotate': 'Rotate minimap',
  'set.language': 'Interface language',
  'set.ch.style': 'Shape',
  'set.ch.color': 'Color',
  'set.ch.size': 'Size',
  'set.ch.opacity': 'Opacity',
  'set.ch.preview': 'Preview',
  'set.ch.custom': 'Custom color',
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
  'setd.quality': 'Sets everything at once: shadows, AO, anti-aliasing, reflections, textures, bloom, particles and render scale.',
  'setd.renderScale': 'Internal resolution. Lower for more FPS, higher for a sharper image.',
  'setd.fov': 'Viewing angle. Wider shows more of your flanks, but targets look smaller.',
  'setd.outlines': 'Signature comic-book ink outlines around fighters and structures.',
  'setd.ao': 'Soft contact shadows in corners and crevices. Adds depth at a performance cost.',
  'setd.bloom': 'Glow of palladium ore, muzzle flashes and explosions.',
  'setd.shadows': 'Sun shadow quality. Lunar shadows are pitch-black and razor sharp.',
  'setd.filmGrain': 'Subtle cinematic grain over the image.',
  'setd.motionBlur': 'Blur during fast camera turns.',
  'setd.showFps': 'FPS and ping counter in the corner of the screen.',
  'setd.sensitivity': 'Camera turn speed with the mouse.',
  'setd.ads': 'Sensitivity multiplier while aiming down sights or scoped.',
  'setd.invertY': 'Moving the mouse up aims down.',
  'setd.toggleAim': 'Press once to aim, press again to stop.',
  'setd.fullscreen': 'The game goes full screen on your first click or key press and when a match starts. F10 toggles full screen at any time; Esc pauses.',
  'setd.toggleCrouch': 'Press once to crouch, again to stand up.',
  'setd.hudScale': 'Size of in-game HUD elements.',
  'setd.hitMarkers': 'A marker flashes on the crosshair when you hit. A red X means an elimination.',
  'setd.damageNumbers': 'Floating damage numbers over your target.',
  'setd.minimapRotate': 'The minimap rotates with you. When off, north is always up.',
  'setd.botDifficulty': 'Bot aim, reaction time and tactics in training and in empty slots.',
  'setd.language': 'Language of menus, tips and HUD.',
  'setd.volume': 'Volume of this audio channel.',
  'setd.keys': 'Click a binding to change it. Conflicting keys swap places.',
  'setd.crosshair': 'Make the crosshair your own: shape, color, size and opacity.',

  'act.forward': 'Forward',
  'act.back': 'Back',
  'act.left': 'Left',
  'act.right': 'Right',
  'act.jump': 'Jump (hold: jetpack)',
  'act.sprint': 'Sprint',
  'act.crouch': 'Crouch / slide',
  'act.fire': 'Fire',
  'act.aim': 'Aim',
  'act.reload': 'Reload',
  'act.ability1': 'Ability 1',
  'act.ability2': 'Ability 2',
  'act.ultimate': 'Ultimate',
  'act.weapon1': 'Primary weapon',
  'act.weapon2': 'Super weapon',
  'act.sealant': 'Sealant',
  'act.mag': 'Mag-boots',
  'act.ping': 'Ping',
  'act.interact': 'Interact / change hero',
  'act.view': 'Toggle third person',
  'act.scoreboard': 'Scoreboard',
  'act.map': 'Map',
  'act.chat': 'Chat',

  'credits.title': 'Credits',
  'credits.tagline': 'A cartoon sci-fi hero shooter about the war for lunar palladium.',
  'credits.design': 'Game design & development',
  'credits.team': 'The MOON GRAVITY team',
  'credits.tech': 'Technology',
  'credits.fonts': 'Fonts',
  'credits.thanks': 'Thank you for fighting for the Moon!',

  'loading.tip': 'Tip',
  'loading.deploy': 'Deploying',
  'mm.title': 'Finding a match',
  'mm.elapsed': 'Elapsed',
  'mm.cancel': 'Cancel',
  'mm.st.searching': 'Searching for an open room…',
  'mm.st.searching_again': 'Trying another room…',
  'mm.st.joining': 'Joining room…',
  'mm.st.joiningTo': 'Joining “{name}”…',
  'mm.st.connected': 'Connected!',
  'mm.st.hosting': 'No open rooms — hosting a new one…',
  'mm.st.hosted': 'Room created — waiting for players',

  'hs.title': 'Choose your hero',
  'hs.confirm': 'Confirm',
  'hs.allies': 'Your team',
  'hs.time': 'Deploy in',
  'hs.hint': 'Enter to confirm',
  'hs.hintClose': 'Esc to close',
  'hs.ffa': 'Free-for-all',

  'pause.title': 'Match menu',
  'pause.resume': 'Resume',
  'pause.settings': 'Settings',
  'pause.copyLink': 'Copy invite link',
  'pause.copied': 'Invite link copied to clipboard',
  'pause.copyFail': "Couldn't copy — select the link manually",
  'pause.leave': 'Leave match',
  'pause.leaveConfirm': 'Leave the match?',
  'pause.host': "You're the host",
  'pause.hostWarn': 'As the host, leaving ends the match for everyone.',
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
  'col.player': 'Player',
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
  'hud.jet': 'Jetpack',
  'hud.suit': 'Suit',
  'hud.mag.off': 'Mag off',
  'hud.mag.on': 'Mag on',
  'hud.mag.attached': 'Anchored',
  'hud.mag.emp': 'EMP',
  'hud.ultReady': 'Ultimate ready',
  'hud.ultReadyShort': 'Ready',
  'hud.reloading': 'Reloading',
  'hud.noAmmo': 'No ammo',
  'hud.lowAmmo': 'Reload',
  'hud.charge': 'Charge',
  'hud.heat': 'Heat',
  'hud.alt': 'Skill',
  'hud.eliminatedBy': 'Eliminated by',
  'hud.env.suffocation': 'You suffocated',
  'hud.env.fall': 'Fatal fall',
  'hud.env.self': 'You eliminated yourself',
  'hud.respawnIn': 'Respawn in',
  'hud.respawning': 'Deploying…',
  'hud.changeHero': 'Change hero',
  'hud.killerHp': "Killer's health",
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
  'hud.limit': 'First to {n}',
  'hud.sealing': 'Sealing',
  'hud.invuln': 'Life Bubble',
  'hud.cloaked': 'Cloaked',
  'hud.killed': 'Eliminated',
  'hud.headshot': 'Headshot',
  'sb.title': 'Scoreboard',
  'scope.rail': 'RAILGUN · CHARGE',
  'scope.nuke': 'POCKET SUN · ARMED',
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

  'mode.duel2v2.players': '2v2',
  'mode.ffa.players': '8 fighters',
  'mode.war4v4.players': '4v4 + bots',
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
  'build.picked': 'Build selected: {b}',
  'mastery.title': 'Mastery',
  'mastery.level': 'Lv. {n}',
  'mastery.xp': '{into} / {need} mastery XP',
  'mastery.short': 'Mastery',
  'gadgets.title': 'Standard kit',
  'gadget.grapple': 'Grappling hook',
  'gadget.grapple.d': 'Pulls you to any surface and brakes on arrival. 18s cooldown.',
  'gadget.melee': 'Quick melee',
  'gadget.melee.d': 'Strike with your rifle butt or fist.',
  'gadget.prone': 'Prone',
  'gadget.prone.d': 'Go flat — smaller silhouette, better accuracy.',
  'gadget.roll': 'Combat roll',
  'gadget.roll.d': 'A quick dodge roll in the direction you move.',
  'gadget.slide': 'Slide',
  'gadget.slide.d': 'Crouch while sprinting to slide across the regolith.',
  'gadget.mantle': 'Mantle',
  'gadget.mantle.d': 'Climb onto ledges automatically.',
  'gadget.jet': 'Jetpack',
  'gadget.jet.d': 'Hold jump for half a second.',
  'gadget.mag': 'Mag-boots',
  'gadget.mag.d': 'Switch on to walk on metal walls and ceilings.',
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
  'setd.lensFlare': 'Glare and lens flares when you look at the Sun.',
  'setd.particles': 'Density of dust, sparks, smoke and debris.',
  'setd.textureQuality': 'Procedural texture resolution. Takes effect next match.',
  'setd.terrainDetail': 'Small craters and pebbles up close.',
  'setd.reflections': 'Environment reflections on metal and visors.',
  'setd.restart': 'Takes effect next match',
  'lvl.low': 'Low',
  'lvl.medium': 'Med',
  'lvl.high': 'High',
  'act.grapple': 'Grappling hook',
  'act.melee': 'Quick melee',
  'act.prone': 'Go prone',
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
      ru: 'Штурмовик орбитального десанта, ветеран высадки на Шеклтон-3. Импульсная винтовка, реактивный рывок и привычка шутить в эфире, когда вокруг всё горит.',
      en: 'Orbital drop trooper and veteran of the Shackleton-3 landing. Packs a pulse rifle, a jet dash and a habit of cracking jokes on comms while everything burns.',
    },
  },
  needle: {
    name: { ru: 'Игла', en: 'Needle' },
    callsign: { ru: 'Ирина Соколова', en: 'Irina Sokolova' },
    tagline: { ru: 'Один выстрел. Одна пробоина.', en: 'One shot. One breach.' },
    bio: {
      ru: 'Бывший маркшейдер палладиевого карьера. С другого края кратера попадает из рельсотрона в заклёпку. Голографические приманки сбивают врага с толку, а датчики движения не дают никому подкрасться.',
      en: 'Former quarry surveyor who can put a railgun slug through a rivet from across the crater. Her holo decoys throw the enemy off, and her motion sensors make sure nobody sneaks up.',
    },
  },
  lunatic: {
    name: { ru: 'Лунатик', en: 'Lunatic' },
    callsign: { ru: 'Бруно Кесслер', en: 'Bruno Kessler' },
    tagline: { ru: 'Взрывотехник с лицензией на карманное солнце.', en: 'Demolitions expert. Licensed to carry a sun.' },
    bio: {
      ru: 'Годами рвал породу в палладиевых шахтах, пока не понял, что на людях это тоже работает. Гранаты по лунной дуге, ракетные прыжки и тактический ядерный заряд за плечами.',
      en: 'Spent years blasting rock in the palladium mines before he found out it works on people too. Lunar-arc grenades, rocket jumps and a tactical nuke on his back.',
    },
  },
  phantom: {
    name: { ru: 'Фантом', en: 'Phantom' },
    callsign: { ru: 'Мира Вэйл', en: 'Mira Vale' },
    tagline: { ru: 'Её не видно и не слышно. В вакууме — тем более.', en: 'Unseen. Unheard. Especially in a vacuum.' },
    bio: {
      ru: 'Бывшая диверсантка SELENE, теперь работает на тех, кто платит палладием. Два дуговых ПП, мгновенные скачки, маскировка и ЭМИ-нова, которая срывает врагов со стен.',
      en: 'Ex-SELENE saboteur who now works for whoever pays in palladium. Twin arc SMGs, a short-range blink, a cloak and an EMP nova that tears enemies off the walls.',
    },
  },
  reactor: {
    name: { ru: 'Реактор', en: 'Reactor' },
    callsign: { ru: 'Гектор Бранко', en: 'Hector Branco' },
    tagline: { ru: 'Ходячий термоядерный щит.', en: 'A walking fusion bulwark.' },
    bio: {
      ru: 'Оператор бурового реактора из шахты Тихо. Весит как луноход, держит удар как купол базы. Ставит щитовой купол, обрушивается на грунт магнитным ударом и открывает чёрную дыру там, где стоял враг.',
      en: 'Drill-reactor operator from the Tycho mine. Heavy as a rover, tough as a base dome. Throws up shield domes, mag-slams the ground and opens a black hole right where the enemy stood.',
    },
  },
  blade: {
    name: { ru: 'Клинок', en: 'Blade' },
    callsign: { ru: 'Кай Мурата', en: 'Kai Murata' },
    tagline: { ru: 'Свет режет вакуум.', en: 'Light cuts through the void.' },
    bio: {
      ru: 'Когда-то работал на горном лазерном резаке, пока не перековал его в плазменную катану. Врывается выпадом, отбивает пули клинком, а в ярости обрушивает на врагов волны лунного света.',
      en: 'Once ran a mining laser cutter — until he reforged it into a plasma katana. Lunges in, bats bullets away with the blade and, when the fury takes him, unleashes waves of moonlight.',
    },
  },
  forge: {
    name: { ru: 'Кузня', en: 'Forge' },
    callsign: { ru: 'Магистр Лука Ферр', en: 'Magister Luka Ferr' },
    tagline: { ru: 'Машина помнит. Машина служит.', en: 'The machine remembers. The machine serves.' },
    bio: {
      ru: 'Техножрец горной гильдии, для которого каждый болт — молитва. Собирает из лома боевых сервиторов, ставит автотурели и окутывает союзников силовыми полями, способными выдержать ракету.',
      en: 'A tech-priest of the mining guild, for whom every bolt is a prayer. Builds combat servitors from scrap, deploys auto-turrets and wraps allies in force fields that can take a rocket.',
    },
  },
  hive: {
    name: { ru: 'Улей', en: 'Hive' },
    callsign: { ru: 'Юна Ким', en: 'Yuna Kim' },
    tagline: { ru: 'Я никогда не прихожу одна.', en: 'I never come alone.' },
    bio: {
      ru: 'Оператор дронов из службы разведки карьера. Дрон-охотник преследует цели, дрон-наводчик подсвечивает врагов команде, а рой камикадзе превращает любую позицию в фейерверк.',
      en: 'Drone operator from the quarry recon service. Her hunter drone runs targets down, her spotter marks enemies for the team, and her kamikaze swarm turns any position into a fireworks show.',
    },
  },
  helios: {
    name: { ru: 'Гелиос', en: 'Helios' },
    callsign: { ru: 'Ада Нкеми', en: 'Ada Nkemi' },
    tagline: { ru: 'Пока я дышу — дышите и вы.', en: 'While I breathe, so do you.' },
    bio: {
      ru: 'Полевой медик и инженер систем жизнеобеспечения. Её пена лечит раны и латает скафандры, кислородный выброс спасает от удушья, а спасательный пузырь делает команду неуязвимой.',
      en: 'Field medic and life-support engineer. Her foam heals wounds and patches suits, her O₂ Burst pulls teammates back from suffocation, and her Life Bubble makes the whole team untouchable.',
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
    desc: { ru: 'Резкий рывок на ранце в направлении движения. Работает и в воздухе.', en: 'A burst of jet thrust in the direction you’re moving. Works in mid-air, too.' },
  },
  frag: {
    name: { ru: 'Осколочная граната', en: 'Frag Grenade' },
    desc: { ru: 'Граната отскакивает от стен и рвётся через 1,8 с. Осколки рвут скафандры и вызывают утечку кислорода.', en: 'A bouncing grenade on a 1.8 s fuse. Shrapnel shreds suits and starts oxygen leaks.' },
  },
  swarm: {
    name: { ru: 'Рой микроракет', en: 'Micro-Missile Swarm' },
    desc: { ru: 'Залп из 16 самонаводящихся микроракет по врагам в районе прицела.', en: 'Unleash 16 homing micro-missiles at the enemies around your crosshair.' },
  },
  decoy: {
    name: { ru: 'Голоприманка', en: 'Holo Decoy' },
    desc: { ru: 'Ваш голографический двойник шагает вперёд и оттягивает вражеский огонь на себя.', en: 'A holographic double of you that walks forward and draws enemy fire.' },
  },
  lunge: {
    name: { ru: 'Выпад', en: 'Lunge' },
    desc: { ru: 'Стремительный рывок с ударом клинка по первому врагу на пути.', en: 'A blazing dash that slashes the first enemy in your path.' },
  },
  deflect: {
    name: { ru: 'Отражение', en: 'Deflect' },
    desc: { ru: 'Клинок отбивает снаряды обратно и блокирует пули — но только спереди.', en: 'Your blade bats projectiles straight back and blocks gunfire from the front.' },
  },
  moonblade: {
    name: { ru: 'Лунный клинок', en: 'Moonblade' },
    desc: { ru: 'Клинок наполняется энергией: удары быстрее и сильнее, а каждый взмах выпускает режущую волну.', en: 'Your blade surges with energy: faster, harder swings, each launching a cutting wave.' },
  },
  servitor: {
    name: { ru: 'Сервитор', en: 'Servitor' },
    desc: { ru: 'Призывает человекоподобного боевого сервитора, который сражается бок о бок с вами.', en: 'Summons a humanoid combat servitor that fights at your side.' },
  },
  turret: {
    name: { ru: 'Автотурель', en: 'Auto-Turret' },
    desc: { ru: 'Разворачивает турель, которая сама обстреливает врагов в поле зрения.', en: 'Deploys a turret that automatically fires at any enemy in sight.' },
  },
  forcefield: {
    name: { ru: 'Силовое поле', en: 'Force Field' },
    desc: { ru: 'Навешивает модули силового поля на союзников рядом: такой щит выдержит даже ракету.', en: 'Projects force-field modules onto nearby allies — a shield that can take a rocket.' },
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
    desc: { ru: 'Дрон зависает над зоной и отмечает врагов для всей команды.', en: 'A drone that hovers over the area and marks enemies for your whole team.' },
  },
  kamikaze: {
    name: { ru: 'Рой камикадзе', en: 'Kamikaze Swarm' },
    desc: { ru: 'Пять дронов-камикадзе сами находят врагов и взрываются.', en: 'Five kamikaze drones hunt down enemies and detonate on contact.' },
  },
  grapple: {
    name: { ru: 'Крюк-кошка', en: 'Grappling Hook' },
    desc: { ru: 'Трос подтягивает вас к любой поверхности, у цели срабатывают воздушные тормоза.', en: 'A tether that reels you in to any surface; air brakes kick in near the anchor.' },
  },
  sensor: {
    name: { ru: 'Датчик движения', en: 'Motion Sensor' },
    desc: { ru: 'Метательный датчик подсвечивает всех врагов в радиусе 20 м для всей команды.', en: 'A thrown sensor that reveals every enemy within 20 m to your whole team.' },
  },
  overcharge: {
    name: { ru: 'Сверхзаряд', en: 'Overcharge' },
    desc: { ru: 'Рельсотрон заряжается мгновенно, бьёт сильнее, а выстрелы пробивают стены.', en: 'Your railgun charges instantly, hits harder and every shot pierces walls.' },
  },
  dome: {
    name: { ru: 'Щитовой купол', en: 'Shield Dome' },
    desc: { ru: 'Купол силового поля держит вражеский огонь, а ваша команда стреляет сквозь него.', en: 'A force-field dome that stops enemy fire while your team shoots straight through.' },
  },
  slam: {
    name: { ru: 'Магнитный удар', en: 'Mag Slam' },
    desc: { ru: 'Прыжок и удар о грунт: ударная волна отбрасывает врагов и срывает их со стен.', en: 'Leap and slam down: the shockwave hurls enemies back and rips them off walls.' },
  },
  blackhole: {
    name: { ru: 'Сингулярность', en: 'Singularity' },
    desc: { ru: 'Сфера-сингулярность затягивает врагов к центру и сминает их.', en: 'A black-hole orb that drags enemies into its core and crushes them.' },
  },
  o2burst: {
    name: { ru: 'Кислородный выброс', en: 'O₂ Burst' },
    desc: { ru: 'Волна лечит вас и союзников рядом, восполняет кислород и латает скафандры.', en: 'A pulse that heals you and nearby allies, refills oxygen and patches suits.' },
  },
  medstation: {
    name: { ru: 'Медстанция', en: 'Med Station' },
    desc: { ru: 'Станция лечит союзников поблизости, подаёт им кислород и чинит скафандры.', en: 'A station that heals nearby allies, feeds them oxygen and repairs their suits.' },
  },
  lifebubble: {
    name: { ru: 'Спасательный пузырь', en: 'Life Bubble' },
    desc: { ru: 'Воздушный пузырь делает неуязвимыми всех союзников внутри.', en: 'An air bubble that makes every ally inside it invulnerable.' },
  },
  rocketjump: {
    name: { ru: 'Ракетный прыжок', en: 'Rocket Jump' },
    desc: { ru: 'Взрыв под ногами подбрасывает вас высоко вверх и ранит врагов рядом.', en: 'A blast under your boots launches you sky-high and hurts enemies nearby.' },
  },
  mine: {
    name: { ru: 'Мина-липучка', en: 'Proximity Mine' },
    desc: { ru: 'Магнитная мина прилипает к любой поверхности и взрывается, когда рядом враг.', en: 'A magnetic mine that sticks to any surface and blows when an enemy comes close.' },
  },
  tacnuke: {
    name: { ru: 'Тактический ядерный удар', en: 'Tactical Nuke' },
    desc: { ru: 'Даёт вам «Карманное солнце» — ядерную ракету. Взрыв накрывает огромную площадь, и даже стены лишь ослабляют удар.', en: 'Hands you the Pocket Sun, a nuclear rocket. The blast covers a huge area, and even walls only soften it.' },
  },
  blink: {
    name: { ru: 'Скачок', en: 'Blink' },
    desc: { ru: 'Мгновенный телепорт на расстояние до 8 м в сторону движения.', en: 'Instantly teleport up to 8 m in the direction you’re moving.' },
  },
  cloak: {
    name: { ru: 'Маскировка', en: 'Cloak' },
    desc: { ru: 'Невидимость на 5 с. Выстрел, удар или способность снимают маскировку.', en: 'Turn invisible for 5 s. Attacking or using an ability breaks the cloak.' },
  },
  empnova: {
    name: { ru: 'ЭМИ-нова', en: 'EMP Nova' },
    desc: { ru: 'Импульс срывает врагов со стен и глушит их ранцы, магнитные ботинки и способности.', en: 'A pulse that tears enemies off walls and shuts down their jetpacks, mag-boots and abilities.' },
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
    desc: { ru: 'Надёжный автомат: вблизи косит длинными очередями, вдали точен короткими.', en: 'A reliable full-auto rifle: sprays up close, stays precise in short bursts.' },
  },
  rail: {
    name: { ru: 'Рельсотрон «Игла»', en: 'Needle Railgun' },
    short: { ru: 'Рельсотрон', en: 'Railgun' },
    desc: { ru: 'Заряжаемый выстрел гиперзвуковым стержнем. Пробивает скафандры навылет.', en: 'Fires a charged hypersonic slug that punches clean through suits.' },
  },
  plasma: {
    name: { ru: 'Плазменный дробовик «Сверхновая»', en: 'Supernova Plasma Shotgun' },
    short: { ru: 'Плазменный дробовик', en: 'Plasma Shotgun' },
    desc: { ru: 'Веер плазменных сгустков в упор. Разговор короткий.', en: 'A point-blank fan of plasma. Keeps conversations short.' },
  },
  glauncher: {
    name: { ru: 'Гранатомёт «Лунатик»', en: 'Lunatic Grenade Launcher' },
    short: { ru: 'Гранатомёт', en: 'Grenade Launcher' },
    desc: { ru: 'Гранаты летят по пологой лунной дуге и отскакивают от стен.', en: 'Grenades fly on a lazy lunar arc and bounce off walls.' },
  },
  sealer: {
    name: { ru: 'Пенный излучатель «Гелиос»', en: 'Helios Foam Projector' },
    short: { ru: 'Пенный излучатель', en: 'Foam Projector' },
    desc: { ru: 'Пена лечит союзников и латает пробитые скафандры, а врагов обжигает.', en: 'Foam that heals allies and patches breached suits — and stings enemies.' },
  },
  twinarc: {
    name: { ru: 'Дуговые ПП «Искры»', en: 'Sparks Twin Arc SMGs' },
    short: { ru: 'Дуговые ПП', en: 'Twin Arc SMGs' },
    desc: { ru: 'Пара скорострельных пистолетов-пулемётов с электрической дугой.', en: 'A pair of rapid-fire SMGs spitting electric arcs.' },
  },
  blade: {
    name: { ru: 'Плазменная катана «Серп»', en: 'Sickle Plasma Katana' },
    short: { ru: 'Плазменная катана', en: 'Plasma Katana' },
    desc: { ru: 'Клинок из перекованного горного резака. Режет и броню, и скафандры.', en: 'A blade reforged from a mining cutter. Slices through armor and suits alike.' },
  },
  riveter: {
    name: { ru: 'Клепальщик «Молот»', en: 'Hammer Riveter' },
    short: { ru: 'Клепальщик', en: 'Riveter' },
    desc: { ru: 'Раскалённые заклёпки с настоящей лунной баллистикой. Вместо перезарядки — перегрев.', en: 'Red-hot rivets on true lunar ballistics. Runs on heat instead of reloads.' },
  },
  burst: {
    name: { ru: 'Винтовка «Трель»', en: 'Trill Burst Rifle' },
    short: { ru: 'Винтовка очередями', en: 'Burst Rifle' },
    desc: { ru: 'Точные очереди по три выстрела. Идеальна в связке с дронами.', en: 'Precise three-round bursts. The perfect partner for your drones.' },
  },
  nuke: {
    name: { ru: 'Ядерная ракета «Карманное солнце»', en: 'Pocket Sun Tactical Nuke' },
    short: { ru: 'Карманное солнце', en: 'Pocket Sun' },
    desc: { ru: 'Переносная тактическая ядерная ракета. Один выстрел — одна новая звезда.', en: 'A man-portable tactical nuclear rocket. One shot, one new star.' },
  },
  singularity: {
    name: { ru: 'Пушка «Сингулярность»', en: 'Singularity Cannon' },
    short: { ru: 'Сингулярность', en: 'Singularity' },
    desc: { ru: 'Стреляет микроскопической чёрной дырой, которая затягивает и сминает всё вокруг.', en: 'Fires a microscopic black hole that drags in and crushes everything nearby.' },
  },
  helios: {
    name: { ru: 'Орбитальный лазер «Солнечное копьё»', en: 'Sunspear Orbital Laser' },
    short: { ru: 'Солнечное копьё', en: 'Sunspear' },
    desc: { ru: 'Целеуказатель наводит орбитальный лазер на точку, и луч сам ползёт за ближайшим врагом.', en: 'Paint a spot and an orbital laser burns it, slowly tracking the nearest enemy.' },
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
    name: { ru: '2 на 2', en: '2v2' },
    desc: {
      ru: 'Две пары бойцов сходятся в тесной схватке над небольшим карьером. Под мостами можно пройти вниз головой.',
      en: 'Two pairs of fighters slug it out over a small open pit. Switch on your mag-boots and walk under the bridges.',
    },
  },
  ffa: {
    name: { ru: 'Каждый сам за себя', en: 'Free-for-All' },
    desc: {
      ru: 'Восемь бойцов в огромном террасном карьере: мосты над пропастью, а по краям — завод, космопорт и силосы.',
      en: 'Eight fighters in a huge terraced pit spanned by bridges and ringed by a plant, a spaceport and silos.',
    },
  },
  war4v4: {
    name: { ru: '4 на 4 — Захват', en: '4v4 — Conquest' },
    desc: {
      ru: 'ARTEMIS против SELENE. Удерживайте точки: A — завод, B — буровую на дне шахты, C — рудные силосы.',
      en: 'ARTEMIS vs SELENE. Hold the points: A, the processing plant; B, the drill rig in the mine; C, the ore silos.',
    },
  },
};

const MAP_COPY: Record<MapId, { name: Bi; desc: Bi }> = {
  duel: {
    name: { ru: 'Шахта-7', en: 'Mine-7' },
    desc: { ru: 'Два аванпоста друг напротив друга над открытой выработкой.', en: 'Two outposts facing off across a compact open pit.' },
  },
  quarry: {
    name: { ru: 'Палладиевый карьер', en: 'Palladium Quarry' },
    desc: { ru: 'Гигантские террасы, мосты и кольцо промышленных комплексов.', en: 'Giant terraces, crossing bridges and a ring of industrial complexes.' },
  },
  front: {
    name: { ru: 'Фронт Тихо', en: 'Tycho Front' },
    desc: { ru: 'Две укреплённые базы и шахта между ними.', en: 'Two fortified bases with the mine in between.' },
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
  ace: { name: { ru: 'Ас', en: 'Ace' }, desc: { ru: 'Лучший счёт в матче', en: 'Top score of the match' } },
  killstreak5: { name: { ru: 'Серия ×5', en: 'Streak ×5' }, desc: { ru: '5 устранений без единой смерти', en: '5 eliminations without dying' } },
  killstreak10: { name: { ru: 'Серия ×10', en: 'Streak ×10' }, desc: { ru: '10 устранений без единой смерти', en: '10 eliminations without dying' } },
  headhunter: { name: { ru: 'Охотник за головами', en: 'Headhunter' }, desc: { ru: '5 устранений выстрелом в голову за матч', en: '5 headshot eliminations in one match' } },
  nuclear: { name: { ru: 'Ядерный клуб', en: 'Nuclear Club' }, desc: { ru: 'Устранение ядерной ракетой', en: 'Eliminate an enemy with the Pocket Sun' } },
  ceiling: { name: { ru: 'Вверх ногами', en: 'Upside Down' }, desc: { ru: 'Устранение со стены или потолка', en: 'Eliminate while walking on a wall or ceiling' } },
  breach: { name: { ru: 'Пробоина', en: 'Breach' }, desc: { ru: 'Враг задохнулся после вашей атаки', en: 'An enemy you hit ran out of oxygen' } },
  capture: { name: { ru: 'Захватчик', en: 'Conqueror' }, desc: { ru: '3 захвата точек за матч', en: '3 point captures in one match' } },
  medic: { name: { ru: 'Ангел-хранитель', en: 'Guardian Angel' }, desc: { ru: 'Вылечить 1000 ед. здоровья за матч', en: 'Heal 1000 HP in one match' } },
  ult: { name: { ru: 'Абсолют', en: 'Absolute' }, desc: { ru: '3 устранения суперспособностью за матч', en: '3 ultimate eliminations in one match' } },
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
  { ru: 'Коротко нажмите [Пробел] — прыжок, удерживайте дольше полсекунды — реактивный ранец. [Shift] — бег.', en: 'Tap [Space] to jump; hold it for more than half a second to fire up the jetpack. [Shift] sprints.' },
  { ru: 'При высадке магнитные ботинки [F] выключены. Включите их, чтобы ходить по металлическим стенам, фасадам и даже потолкам.', en: 'Mag-boots [F] start switched off. Turn them on to walk on metal walls, facades and even ceilings.' },
  { ru: 'Прыжок поднимает всего метра на два. Чтобы забраться выше, используйте ранец или крюк-кошку [G].', en: 'A jump only gets you about 2 m off the ground. To climb higher, use the jetpack or the grappling hook [G].' },
  { ru: 'Когда прочность скафандра падает ниже 50%, начинается утечка кислорода. Залатайте пробоину герметиком [H].', en: 'Once your suit drops below 50%, it starts leaking oxygen. Seal the breach with sealant [H].' },
  { ru: 'Кислородные баллоны в постройках восполняют O₂ и латают скафандр.', en: 'O₂ canisters inside buildings refill your oxygen and patch your suit.' },
  { ru: 'Капсулы снабжения падают с орбиты. Внутри может оказаться «Карманное солнце».', en: 'Supply pods drop from orbit. You might find a Pocket Sun inside.' },
  { ru: 'Когда рядом Фантом, не висите под потолком: её ЭМИ-нова срывает всех со стен и глушит ранцы.', en: 'Don’t hang from the ceiling when Phantom is near: her EMP Nova tears everyone off the walls and kills jetpacks.' },
  { ru: 'Топливо ранца восполняется, пока вы стоите на любой поверхности.', en: 'Your jetpack refuels while you’re standing on any surface.' },
  { ru: 'На Шахте-7 под мостами можно пройти вниз головой — отличный путь для засады.', en: 'On Mine-7 you can walk under the bridges upside down — a perfect ambush route.' },
  { ru: 'Рельсотрон рвёт скафандры: даже выжив после попадания, противник может задохнуться.', en: 'The railgun tears suits open: a target that survives the hit may still suffocate.' },
  { ru: 'Спасательный пузырь — суперспособность Гелиос — защищает даже от ядерного удара.', en: 'Helios’s Life Bubble even shields your team from a nuke.' },
  { ru: 'Палладий (Pd-46) — главное богатство Луны. Именно из-за него и идёт война.', en: 'Palladium (Pd-46) is the Moon’s greatest treasure — and the reason this war is being fought.' },
  { ru: 'В вакууме звуки глухие — следите за индикаторами урона вокруг прицела.', en: 'Sound is muffled in a vacuum — watch the damage indicators around your crosshair.' },
  { ru: 'Удушье наступает не сразу: у вас есть время добраться до кислородного баллона или до союзника с пеной.', en: 'Suffocation isn’t instant: you have time to reach an O₂ canister or an ally with a foam projector.' },
  { ru: 'Точка B лежит на дне шахты: сверху её удобно простреливать, а спускаться туда опасно.', en: 'Point B sits at the bottom of the mine: easy to shoot into from above, dangerous to go down to.' },
  { ru: 'Гранаты, заклёпки и пена летят по настоящей лунной баллистике (1/6 g) и почти не проседают — цельтесь ниже, чем привыкли.', en: 'Grenades, rivets and foam follow true lunar ballistics (1/6 g) and barely drop — aim lower than you’re used to.' },
  { ru: 'Крюк-кошка [G] есть у каждого бойца. У цели сами включаются воздушные тормоза, а [Пробел] отцепляет трос с разгона. Перезарядка — 18 с.', en: 'Every fighter carries a grappling hook [G]. Air brakes kick in near the anchor; press [Space] to let go and slingshot. 18 s cooldown.' },
  { ru: 'Сервиторы Кузни оттягивают огонь на себя — уничтожайте их первыми или обходите.', en: 'Forge’s servitors draw fire — take them out first or flank them.' },
  { ru: 'Отражение Клинка отправляет снаряды обратно. Не стреляйте ему в лицо, пока клинок светится.', en: 'Blade’s Deflect sends projectiles straight back. Don’t shoot him head-on while his blade glows.' },
  { ru: 'Пока вы мертвы, нажмите [Y], чтобы сменить героя до возрождения.', en: 'While you’re down, press [Y] to switch heroes before you respawn.' },
  { ru: '[V] — быстрый удар в ближнем бою. Выручает, когда враг вплотную, а патроны кончились.', en: '[V] is a quick melee strike — a lifesaver when an enemy is in your face and you’re out of ammo.' },
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

// ---------------------------------------------------------------------------
// passives & weapon skills

const PASSIVE_COPY: Record<PassiveId, { name: Bi; desc: Bi }> = {
  afterburner: {
    name: { ru: 'Форсаж', en: 'Afterburner' },
    desc: { ru: 'Ранец заправляется на 60% быстрее и понемногу восполняет топливо даже в полёте, пока вы не включаете тягу.', en: 'Your jetpack refuels 60% faster and even trickles fuel back in mid-air while you’re not thrusting.' },
  },
  blastproof: {
    name: { ru: 'Взрывостойкость', en: 'Blastproof' },
    desc: { ru: 'Собственные взрывы не наносят вам урона, а ударная волна подбрасывает сильнее — прыгайте на гранатах сколько угодно.', en: 'Your own explosions don’t hurt you and launch you harder. Blast-jump to your heart’s content.' },
  },
  spotter: {
    name: { ru: 'Метка снайпера', en: 'Spotter' },
    desc: { ru: 'Попадание в голову подсвечивает цель для всей команды на 3 с.', en: 'Headshots reveal the target to your whole team for 3 s.' },
  },
  backstab: {
    name: { ru: 'Удар в спину', en: 'Backstab' },
    desc: { ru: '+25% урона по врагам, стоящим к вам спиной.', en: '+25% damage to enemies facing away from you.' },
  },
  moonstep: {
    name: { ru: 'Лунный шаг', en: 'Moon Step' },
    desc: { ru: 'Двойной прыжок: в воздухе двигатели скафандра дают толчок в сторону движения.', en: 'Double jump: in mid-air, your suit thrusters kick you in the direction you’re moving.' },
  },
  fusion: {
    name: { ru: 'Термоядерная броня', en: 'Fusion Plating' },
    desc: { ru: 'Пока скафандр держится (прочность от 50%), входящий урон снижен на 20%.', en: 'While your suit holds (50% integrity or more), incoming damage is reduced by 20%.' },
  },
  lifelink: {
    name: { ru: 'Жизнеобеспечение', en: 'Life-Support Link' },
    desc: { ru: 'Союзники в радиусе 12 м теряют кислород при разгерметизации вдвое медленнее и восстанавливают 4 ед. здоровья в секунду.', en: 'Allies within 12 m leak oxygen half as fast when breached and regenerate 4 HP per second.' },
  },
  fieldrepair: {
    name: { ru: 'Полевой ремонт', en: 'Field Repairs' },
    desc: { ru: 'Скафандры союзников в радиусе 10 м (и ваш собственный) восстанавливаются на 4% в секунду — пробоина затянется и без герметика.', en: 'Your suit and those of allies within 10 m repair 4% per second — breaches close without sealant.' },
  },
  dronelink: {
    name: { ru: 'Связь роя', en: 'Drone Link' },
    desc: { ru: 'Попадание из винтовки ненадолго выдаёт врага команде и помечает его на 2,5 с: ваши дроны и турели наносят ему на 25% больше урона.', en: 'Rifle hits briefly reveal an enemy to your team and mark it for 2.5 s: your drones and turrets deal 25% more damage to it.' },
  },
};

const ROLE_PASSIVE_COPY: Record<RolePassiveId, { name: Bi; desc: Bi }> = {
  heavy: { name: { ru: 'Тяжёлый каркас', en: 'Heavy Frame' }, desc: { ru: 'Вас труднее отбросить, а замедления действуют вдвое слабее.', en: 'Reduced knockback; slows are half as strong.' } },
  medic: { name: { ru: 'Полевая выучка', en: 'Field Medic' }, desc: { ru: 'Здоровье начинает восстанавливаться уже через 3,5 с без урона (вместо 6 с).', en: 'Health starts regenerating after 3.5 s without damage (instead of 6 s).' } },
  lightstep: { name: { ru: 'Лёгкий шаг', en: 'Light Step' }, desc: { ru: 'Шаги почти не слышны, по стенам на магнитных ботинках вы ходите на 25% быстрее, а падения безопаснее.', en: 'Near-silent footsteps, 25% faster walking on mag-boots and safer falls.' } },
  bloodrush: { name: { ru: 'Кураж', en: 'Bloodrush' }, desc: { ru: 'Каждое устранение восстанавливает 50 ед. здоровья; лучше управление в воздухе.', en: 'Eliminations restore 50 HP; better air control.' } },
  steady: { name: { ru: 'Твёрдая рука', en: 'Steady Hands' }, desc: { ru: 'Отдача и разброс на 20% меньше, перезарядка на 15% быстрее.', en: '20% less recoil and bloom, 15% faster reloads.' } },
  salvage: { name: { ru: 'Утилизация', en: 'Salvage' }, desc: { ru: 'Уничтожив вражескую технику или сервитора, вы восстанавливаете 40 ед. здоровья и немного заряда суперспособности. Перезарядка на 10% быстрее.', en: 'Destroying an enemy device or servitor restores 40 HP and some ultimate charge. 10% faster reloads.' } },
};

const WEAPON_SKILL: Partial<Record<WeaponId, Bi>> = {
  pulse: { ru: 'ПКМ — голографический прицел. Первый выстрел после паузы в прицеле идёт точно в цель и бьёт на 15% сильнее. Ствол уводит вверх — тяните мышь вниз.', en: 'RMB — holo sight. Your first shot from rest while aiming is pinpoint-accurate and hits 15% harder. Pull down to fight the climb.' },
  rail: { ru: 'ПКМ — оптика и заряд (0,9 с). Полный заряд: 100 урона в тело, 230 в голову. Без заряда — лишь 42%.', en: 'RMB — scope and charge (0.9 s). Full charge: 100 body, 230 head. Uncharged shots deal only 42%.' },
  plasma: { ru: 'ПКМ — сфокусированный плазменный заряд (2 ячейки): быстрый выстрел на среднюю дистанцию.', en: 'RMB — focused plasma slug (2 cells): a fast mid-range poke.' },
  glauncher: { ru: 'ПКМ — дистанционный подрыв всех ваших гранат.', en: 'RMB — remotely detonate all of your grenades.' },
  sealer: { ru: 'ПКМ — липкий сгусток пены (5 ячеек): лужа на 5 с лечит союзников и замедляет врагов.', en: 'RMB — sticky foam glob (5 cells): a 5 s puddle that heals allies and slows enemies.' },
  twinarc: { ru: 'Статика: каждое 10-е попадание подряд по одной цели разряжается дугой (+20 урона), которая перескакивает на соседнего врага.', en: 'Static: every 10th consecutive hit on one target discharges an arc (+20 damage) that jumps to a nearby enemy.' },
  blade: { ru: 'Комбо: каждый третий удар подряд — тяжёлый добивающий (×1,5 урона, шире и дальше).', en: 'Combo: every third swing in a row is a heavy finisher (×1.5 damage, wider and longer reach).' },
  riveter: { ru: 'Без перезарядки: 32 заклёпки до перегрева (2 с на остывание). R — досрочный сброс тепла.', en: 'No reloads: 32 rivets to overheat (2 s lockout). R vents the heat early.' },
  burst: { ru: '«Трель»: если первые два выстрела очереди попали в одну цель, третий наносит +60% урона.', en: 'Trill: if the first two rounds of a burst hit the same target, the third deals +60% damage.' },
};

export function passiveName(id: PassiveId): string {
  return PASSIVE_COPY[id] ? pick(PASSIVE_COPY[id].name) : id;
}
export function passiveDesc(id: PassiveId): string {
  return PASSIVE_COPY[id] ? pick(PASSIVE_COPY[id].desc) : '';
}
export function rolePassiveName(id: RolePassiveId): string {
  return ROLE_PASSIVE_COPY[id] ? pick(ROLE_PASSIVE_COPY[id].name) : id;
}
export function rolePassiveDesc(id: RolePassiveId): string {
  return ROLE_PASSIVE_COPY[id] ? pick(ROLE_PASSIVE_COPY[id].desc) : '';
}
export function weaponSkill(id: WeaponId): string {
  const b = WEAPON_SKILL[id];
  return b ? pick(b) : '';
}
