/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect } from 'react';
import {
  ArrowRight,
  Clock,
  Menu,
  X,
  CheckCircle2,
  Search,
  MapPin,
  Send,
  Filter,
  Users,
  TrendingUp,
  Calculator,
  ChevronDown,
  ShieldCheck,
  Database,
  PhoneCall,
  Sparkles,
  Sliders,
  ExternalLink,
  Building2,
  AlertCircle
} from 'lucide-react';
import { Shader, Swirl, ChromaFlow, FlutedGlass, FilmGrain } from 'shaders/react';

// Starburst / compass partner SVG icon
function PartnerIcon({ className }: { className?: string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 100 100"
      className={className}
      aria-hidden="true"
    >
      <path d="m19.6 66.5 19.7-11 .3-1-.3-.5h-1l-3.3-.2-11.2-.3L14 53l-9.5-.5-2.4-.5L0 49l.2-1.5 2-1.3 2.9.2 6.3.5 9.5.6 6.9.4L38 49.1h1.6l.2-.7-.5-.4-.4-.4L29 41l-10.6-7-5.6-4.1-3-2-1.5-2-.6-4.2 2.7-3 3.7.3.9.2 3.7 2.9 8 6.1L37 36l1.5 1.2.6-.4.1-.3-.7-1.1L33 25l-6-10.4-2.7-4.3-.7-2.6c-.3-1-.4-2-.4-3l3-4.2L28 0l4.2.6L33.8 2l2.6 6 4.1 9.3L47 29.9l2 3.8 1 3.4.3 1h.7v-.5l.5-7.2 1-8.7 1-11.2.3-3.2 1.6-3.8 3-2L61 2.6l2 2.9-.3 1.8-1.1 7.7L59 27.1l-1.5 8.2h.9l1-1.1 4.1-5.4 6.9-8.6 3-3.5L77 13l2.3-1.8h4.3l3.1 4.7-1.4 4.9-4.4 5.6-3.7 4.7-5.3 7.1-3.2 5.7.3.4h.7l12-2.6 6.4-1.1 7.6-1.3 3.5 1.6.4 1.6-1.4 3.4-8.2 2-9.6 2-14.3 3.3-.2.1.2.3 6.4.6 2.8.2h6.8l12.6 1 3.3 2 1.9 2.7-.3 2-5.1 2.6-6.8-1.6-16-3.8-5.4-1.3h-.8v.4l4.6 4.5 8.3 7.5L89 80.1l.5 2.4-1.3 2-1.4-.2-9.2-7-3.6-3-8-6.8h-.5v.7l1.8 2.7 9.8 14.7.5 4.5-.7 1.4-2.6 1-2.7-.6-5.8-8-6-9-4.7-8.2-.5.4-2.9 30.2-1.3 1.5-3 1.2-2.5-2-1.4-3 1.4-6.2 1.6-8 1.3-6.4 1.2-7.9.7-2.6v-.2H49L43 72l-9 12.3-7.2 7.6-1.7.7-3-1.5.3-2.8L24 86l10-12.8 6-7.9 4-4.6-.1-.5h-.3L17.2 77.4l-4.7.6-2-2 .2-3 1-1 8-5.5Z" />
    </svg>
  );
}

// Chain link icon drawn with two arc paths
function ChainLinkIcon({ className }: { className?: string }) {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
      <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
    </svg>
  );
}

// Text roll button with rotating arrow
interface RollButtonProps {
  text: string;
  variant?: 'orange' | 'dark' | 'outline';
  size?: 'sm' | 'md';
  onClick?: () => void;
  className?: string;
}

function RollButton({
  text,
  variant = 'orange',
  size = 'md',
  onClick,
  className = '',
}: RollButtonProps) {
  const isDark = variant === 'dark';
  const isOutline = variant === 'outline';
  const isSm = size === 'sm';

  return (
    <button
      onClick={onClick}
      className={`group inline-flex items-center gap-3 rounded-full font-medium cursor-pointer transition-colors duration-300 ${
        isSm
          ? 'pl-5 pr-2 py-2 text-[13px]'
          : 'pl-5 sm:pl-6 pr-2 py-2 text-[13px] sm:text-[14px]'
      } ${
        isOutline
          ? 'bg-transparent hover:bg-gray-100 text-gray-900 border border-gray-300'
          : isDark
          ? 'bg-gray-900 hover:bg-black text-white'
          : 'bg-[#F26522] hover:bg-[#e05a1a] text-white'
      } ${className}`}
    >
      <div className="overflow-hidden h-[20px] flex flex-col justify-start">
        <div className="flex flex-col transition-transform duration-500 ease-[cubic-bezier(0.25,0.1,0.25,1)] group-hover:-translate-y-1/2">
          <span className="leading-[20px] whitespace-nowrap">{text}</span>
          <span className="leading-[20px] whitespace-nowrap">{text}</span>
        </div>
      </div>
      <div
        className={`rounded-full flex items-center justify-center shrink-0 transition-transform duration-500 ease-[cubic-bezier(0.25,0.1,0.25,1)] group-hover:-rotate-45 ${
          isSm || isDark
            ? 'w-6 h-6 bg-white text-gray-900'
            : isOutline
            ? 'w-7 h-7 sm:w-8 sm:h-8 bg-gray-900 text-white'
            : 'w-7 h-7 sm:w-8 sm:h-8 bg-white text-[#F26522]'
        }`}
      >
        <ArrowRight className={`${isSm || isDark ? 'w-3.5 h-3.5' : 'w-4 h-4'} stroke-[2.2]`} />
      </div>
    </button>
  );
}

// Data for interactive 2GIS Scanner Demo
const CITIES = ['Москва', 'Санкт-Петербург', 'Екатеринбург', 'Казань', 'Новосибирск'];
const NICHES = [
  'Автосервисы и детейлинг',
  'Стоматологии и клиники',
  'Мебельные производства',
  'Оптовые B2B базы',
  'Юридические компании',
];

interface MockBusiness {
  id: string;
  name: string;
  category: string;
  address: string;
  rating: number;
  reviewsCount: number;
  hasWebsite: boolean;
  decisionMaker: string;
  phoneMasked: string;
  lostRevenueEstimate: string;
}

export default function App() {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [leadModalOpen, setLeadModalOpen] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [contactValue, setContactValue] = useState('');
  const [nicheValue, setNicheValue] = useState('');
  const [moscowTime, setMoscowTime] = useState<string>('00:00');

  // Interactive 2GIS scanner state
  const [selectedCity, setSelectedCity] = useState('Москва');
  const [selectedNiche, setSelectedNiche] = useState('Автосервисы и детейлинг');
  const [isScanning, setIsScanning] = useState(false);

  // ROI Calculator state
  const [leadsCount, setLeadsCount] = useState(100);
  const [averageCheck, setAverageCheck] = useState(180000);
  const [conversionRate, setConversionRate] = useState(15);

  // FAQ Accordion state
  const [openFaqIndex, setOpenFaqIndex] = useState<number | null>(0);

  useEffect(() => {
    const updateTime = () => {
      try {
        const formatted = new Intl.DateTimeFormat('ru-RU', {
          timeZone: 'Europe/Moscow',
          hour: '2-digit',
          minute: '2-digit',
          hour12: false,
        }).format(new Date());
        setMoscowTime(formatted);
      } catch {
        const d = new Date();
        const hh = String(d.getHours()).padStart(2, '0');
        const mm = String(d.getMinutes()).padStart(2, '0');
        setMoscowTime(`${hh}:${mm}`);
      }
    };

    updateTime();
    const interval = setInterval(updateTime, 1000);
    return () => clearInterval(interval);
  }, []);

  // Simulate fast scan when filters change
  const triggerScan = (city: string, niche: string) => {
    setSelectedCity(city);
    setSelectedNiche(niche);
    setIsScanning(true);
    setTimeout(() => {
      setIsScanning(false);
    }, 400);
  };

  const handleLeadSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!contactValue) return;
    setSubmitted(true);
    setTimeout(() => {
      setSubmitted(false);
      setLeadModalOpen(false);
      setContactValue('');
      setNicheValue('');
    }, 2400);
  };

  // Dynamic calculations for 2GIS Scanner
  const multiplier = (selectedCity.length + selectedNiche.length) * 17;
  const totalFound = 380 + (multiplier % 240);
  const withoutWebsite = Math.round(totalFound * 0.41);
  const percentWithoutWebsite = Math.round((withoutWebsite / totalFound) * 100);
  const lprContactsFound = Math.round(withoutWebsite * 0.88);

  // Dynamic companies list
  const sampleBusinesses: MockBusiness[] = [
    {
      id: '1',
      name: `ТехЦентр "${selectedCity === 'Москва' ? 'Варшавский' : selectedCity.slice(0, 5) + '-Драйв'}"`,
      category: selectedNiche,
      address: `г. ${selectedCity}, ул. Промышленная, 14к2`,
      rating: 4.8,
      reviewsCount: 142,
      hasWebsite: false,
      decisionMaker: 'Собственник (ИП Воронов А. В.)',
      phoneMasked: '+7 (926) ***-48-19',
      lostRevenueEstimate: '1.2 — 1.8 млн ₽/мес',
    },
    {
      id: '2',
      name: `Компания "${selectedCity.slice(0, 4)}Групп B2B"`,
      category: selectedNiche,
      address: `г. ${selectedCity}, ш. Энтузиастов, 88`,
      rating: 4.9,
      reviewsCount: 89,
      hasWebsite: false,
      decisionMaker: 'Генеральный директор',
      phoneMasked: '+7 (903) ***-81-02',
      lostRevenueEstimate: '2.4 — 3.1 млн ₽/мес',
    },
    {
      id: '3',
      name: `Фабрика-Студия "${selectedCity} Престиж"`,
      category: selectedNiche,
      address: `г. ${selectedCity}, наб. Обводного канала, 5`,
      rating: 4.7,
      reviewsCount: 215,
      hasWebsite: false,
      decisionMaker: 'Управляющий партнер',
      phoneMasked: '+7 (916) ***-15-44',
      lostRevenueEstimate: '950 тыс. — 1.5 млн ₽/мес',
    },
  ];

  // ROI Calculator Math
  const fracsCost = Math.round(leadsCount * 280);
  const directAdsCost = Math.round(leadsCount * 3150);
  const savedBudget = directAdsCost - fracsCost;
  const closedDeals = Math.max(1, Math.round(leadsCount * (conversionRate / 100)));
  const projectedRevenue = closedDeals * averageCheck;

  const faqs = [
    {
      question: 'Законно ли парсить контакты организаций из 2ГИС?',
      answer:
        'Да, абсолютно законно. Сервис 2ГИС является общедоступным справочником открытых данных о юридических лицах и ИП. Fracs собирает исключительно публичную информацию об организациях (названия, фактические адреса, сферы деятельности и контакты), не нарушая ФЗ-152.',
    },
    {
      question: 'Не заблокируют ли мой личный Telegram аккаунт при рассылке?',
      answer:
        'Ваш личный Telegram аккаунт не используется для первичного контакта. Fracs использует собственную распределенную ферму прогретых доверенных бизнес-профилей с уникальными прокси и динамическими интервалами. Все заинтересовавшиеся ЛПР сразу переводятся по прямой ссылке в ваш личный чат или CRM.',
    },
    {
      question: 'Как Fracs определяет, есть ли у компании сайт или нет?',
      answer:
        'Алгоритм проверяет карту организации в 2ГИС, анализирует поле URL, проводит DNS-проверку домена (часто сайты зарегистрированы, но не работают или ведут на страницу ошибки 404/парковку) и проверяет наличие активных посадочных страниц. Вы получаете только тех, у кого действительно нет работающего сайта.',
    },
    {
      question: 'Через сколько дней мы получим первые целевые обращения?',
      answer:
        'Сбор и верификация базы 2ГИС занимает до 24 часов. Первые касания в Telegram начинаются на следующий рабочий день. В среднем первые 5–12 ответов от заинтересованных ЛПР наши клиенты получают уже в течение первых 48 часов с момента старта.',
    },
    {
      question: 'Можно ли интегрировать передачу лидов в нашу CRM?',
      answer:
        'Да! Мы настраиваем мгновенную передачу заявок через Webhook в amoCRM, Битрикс24, Telegram-бот или Google Таблицы со всеми полями: ссылка на компанию в 2ГИС, ФИО ЛПР, телефон, ниша и текст первичного согласия на созвон.',
    },
  ];

  return (
    <div className="min-h-screen bg-[#EFEFEF] text-gray-900 selection:bg-[#F26522] selection:text-white font-sans antialiased">
      {/* =========================================================================
          SECTION 1: HERO (Full viewport height)
      ========================================================================= */}
      <section id="hero" className="relative min-h-screen flex flex-col justify-between overflow-hidden bg-[#EFEFEF]">
        {/* Animated shader overlay */}
        <div className="absolute inset-0 z-10 pointer-events-none w-full h-full">
          <Shader className="w-full h-full" disableTelemetry>
            <Swirl colorA="#ffffff" colorB="#f0f0f0" detail={1.7} />
            <ChromaFlow
              baseColor="#ffffff"
              downColor="#ff5f03"
              leftColor="#ff5f03"
              rightColor="#ff5f03"
              upColor="#ff5f03"
              momentum={13}
              radius={3.5}
            />
            <FlutedGlass
              aberration={0.61}
              angle={31}
              frequency={8}
              highlight={0.12}
              highlightSoftness={0}
              lightAngle={-90}
              refraction={4}
              shape="rounded"
              softness={1}
              speed={0.15}
            />
            <FilmGrain strength={0.05} />
          </Shader>
        </div>

        {/* Navigation (z-20, relative) */}
        <header className="relative z-20 w-full max-w-[1440px] mx-auto p-2 sm:p-3">
          <nav className="bg-white rounded-full p-[5px] flex items-center justify-between shadow-xs">
            {/* LEFT */}
            <div className="flex items-center">
              <a
                href="#hero"
                aria-label="Fracs Главная"
                className="w-9 h-9 sm:w-10 sm:h-10 bg-gray-900 rounded-full flex items-center justify-center shrink-0 hover:bg-black transition-colors"
              >
                <span className="text-[10px] sm:text-[11px] font-bold text-white tracking-tight font-heading">
                  FR
                </span>
              </a>

              <div className="hidden md:flex items-center gap-6 ml-6">
                <a
                  href="#about"
                  className="text-[14px] text-gray-900 hover:text-gray-500 transition-colors duration-300 font-medium"
                >
                  О сервисе
                </a>
                <a
                  href="#tools"
                  className="text-[14px] text-gray-900 hover:text-gray-500 transition-colors duration-300 font-medium flex items-center gap-1.5"
                >
                  <span>Поиск 2ГИС</span>
                  <span className="text-[10px] bg-orange-100 text-[#F26522] px-1.5 py-0.5 rounded font-semibold">
                    New
                  </span>
                </a>
                <a
                  href="#telegram"
                  className="text-[14px] text-gray-900 hover:text-gray-500 transition-colors duration-300 font-medium"
                >
                  Telegram Аутрич
                </a>
                <a
                  href="#projects"
                  className="text-[14px] text-gray-900 hover:text-gray-500 transition-colors duration-300 font-medium"
                >
                  Кейсы
                </a>
                <a
                  href="#calculator"
                  className="text-[14px] text-gray-900 hover:text-gray-500 transition-colors duration-300 font-medium"
                >
                  Калькулятор
                </a>
                <a
                  href="#pricing"
                  className="text-[14px] text-gray-900 hover:text-gray-500 transition-colors duration-300 font-medium"
                >
                  Тарифы
                </a>
              </div>
            </div>

            {/* RIGHT (hidden on mobile, shown md+) */}
            <div className="hidden md:flex items-center gap-5 sm:gap-6 pr-1">
              <span className="text-[13px] text-gray-600 hidden lg:inline">
                Берем 3 проекта на ноябрь 2026
              </span>

              <div className="flex items-center gap-1.5 text-[13px] text-gray-600">
                <Clock className="w-3.5 h-3.5 stroke-[2] text-gray-500" />
                <span>{moscowTime} по МСК</span>
              </div>

              <RollButton
                text="Рассчитать стоимость"
                variant="dark"
                size="sm"
                onClick={() => setLeadModalOpen(true)}
              />
            </div>

            {/* MOBILE toggle button */}
            <div className="md:hidden flex items-center mr-1">
              <button
                type="button"
                onClick={() => setMobileMenuOpen(true)}
                aria-label="Открыть меню"
                className="w-9 h-9 bg-gray-900 text-white rounded-full flex items-center justify-center hover:bg-black transition-colors cursor-pointer"
              >
                <Menu className="w-4 h-4" />
              </button>
            </div>
          </nav>
        </header>

        {/* Hero Content (z-20) */}
        <div className="relative z-20 w-full max-w-[1440px] mx-auto px-5 sm:px-8 lg:px-12 pb-14 sm:pb-16 lg:pb-20 flex-1 flex flex-col justify-end">
          {/* Small label */}
          <div className="inline-flex items-center gap-2 mb-5 sm:mb-8">
            <span className="w-2 h-2 rounded-full bg-[#F26522] animate-pulse" />
            <p className="text-[13px] sm:text-[14px] text-gray-900 font-medium tracking-wide">
              Fracs • Платформа умной лидогенерации
            </p>
          </div>

          {/* Headline h1: Powerful Hook in Jost */}
          <h1 className="font-heading text-[clamp(1.75rem,7vw,4.2rem)] sm:text-[clamp(2.5rem,5vw,4.2rem)] font-medium leading-[1.08] tracking-[-0.03em] text-gray-900 max-w-5xl">
            Клиенты не падают с неба. 
            <br className="hidden sm:block" />
            <span className="sm:hidden"> </span>
            Но мы знаем, как их достать
            
          </h1>

          {/* CTA row */}
          <div className="mt-8 sm:mt-12 flex flex-col sm:flex-row items-start sm:items-center gap-4 sm:gap-5">
            <RollButton
              text="Получить 20 лидов на тест"
              variant="orange"
              size="md"
              onClick={() => setLeadModalOpen(true)}
            />

            
          </div>
        </div>

        {/* Mobile Menu Overlay */}
        {mobileMenuOpen && (
          <div className="fixed inset-0 z-50 flex flex-col justify-end">
            <div
              onClick={() => setMobileMenuOpen(false)}
              className="absolute inset-0 bg-black/60 transition-opacity duration-300"
              aria-hidden="true"
            />

            <div className="relative z-10 bg-white rounded-2xl mx-3 mb-3 p-6 sm:p-8 flex flex-col gap-6 shadow-2xl transition-transform duration-500 ease-[cubic-bezier(0.32,0.72,0,1)] animate-in slide-in-from-bottom">
              <div className="flex items-center justify-between pb-2 border-b border-gray-100">
                <div className="flex items-center gap-1.5 text-[13px] text-gray-600">
                  <Clock className="w-3.5 h-3.5 stroke-[2] text-gray-500" />
                  <span>{moscowTime} по МСК</span>
                </div>
                <button
                  type="button"
                  onClick={() => setMobileMenuOpen(false)}
                  aria-label="Закрыть меню"
                  className="w-9 h-9 bg-gray-100 hover:bg-gray-200 text-gray-900 rounded-full flex items-center justify-center transition-colors cursor-pointer"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              <div className="flex flex-col gap-3 py-2">
                {[
                  { label: 'О сервисе', href: '#about' },
                  { label: 'Поиск 2ГИС', href: '#tools' },
                  { label: 'Telegram Аутрич', href: '#telegram' },
                  { label: 'Кейсы', href: '#projects' },
                  { label: 'Калькулятор ROI', href: '#calculator' },
                  { label: 'Тарифы', href: '#pricing' },
                  { label: 'Частые вопросы', href: '#faq' },
                ].map((item) => (
                  <a
                    key={item.label}
                    href={item.href}
                    onClick={() => setMobileMenuOpen(false)}
                    className="text-[24px] sm:text-[28px] font-medium text-gray-900 hover:text-gray-500 transition-colors font-heading"
                  >
                    {item.label}
                  </a>
                ))}
              </div>

              <div className="pt-2">
                <RollButton
                  text="Получить 20 лидов бесплатно"
                  variant="orange"
                  size="md"
                  className="w-full justify-between"
                  onClick={() => {
                    setMobileMenuOpen(false);
                    setLeadModalOpen(true);
                  }}
                />
              </div>
            </div>
          </div>
        )}
      </section>

      {/* =========================================================================
          SECTION 2: ABOUT (White background)
      ========================================================================= */}
      <section id="about" className="bg-white pt-16 sm:pt-20 lg:pt-32 pb-12 sm:pb-16 lg:pb-24 overflow-hidden">
        <div className="max-w-[1440px] mx-auto">
          {/* Badge row */}
          <div className="px-5 sm:px-8 lg:px-12 flex items-center gap-3 mb-6 sm:mb-8">
            <span className="w-6 h-6 sm:w-7 sm:h-7 rounded-full bg-gray-900 text-white text-[11px] sm:text-[12px] font-semibold flex items-center justify-center shrink-0">
              1
            </span>
            <span className="text-[12px] sm:text-[13px] font-medium border border-gray-200 rounded-full px-3 sm:px-4 py-1 sm:py-1.5 text-gray-900">
              Технология Fracs
            </span>
          </div>

          {/* Heading h2 */}
          <h2 className="font-heading text-[clamp(1.5rem,4vw,3.2rem)] font-medium leading-[1.12] tracking-[-0.02em] text-gray-900 mb-12 sm:mb-16 lg:mb-28 px-5 sm:px-8 lg:px-12 max-w-5xl">
            Находим клиентов там, где другие не ищут:
            карты 2ГИС и прямой парсинг в Telegram.
          </h2>

          {/* Content area: MOBILE/TABLET (lg:hidden) */}
          <div className="lg:hidden px-5 sm:px-8">
            <p className="text-[15px] sm:text-[17px] leading-[1.6] font-medium text-gray-900 mb-6 max-w-xl">
              Fracs автоматически сканирует карты 2ГИС, выявляет прибыльные бизнесы без сайтов, выгружает контакты лиц, принимающих решения, и запускает точечный аутрич через Telegram.
            </p>
            <div className="mb-8 sm:mb-10">
              <RollButton
                text="Узнать алгоритм работы"
                variant="orange"
                size="md"
                onClick={() => setLeadModalOpen(true)}
              />
            </div>

            <div className="flex flex-col sm:flex-row gap-4 sm:gap-5">
              <div className="sm:w-[45%] aspect-[438/346] rounded-xl sm:rounded-2xl overflow-hidden bg-gray-100">
                <img
                  src="https://images.unsplash.com/photo-1551288049-bebda4e38f71?auto=format&fit=crop&w=1200&q=80"
                  alt="Интерфейс парсинга 2ГИС Fracs"
                  className="w-full h-full object-cover"
                  loading="lazy"
                />
              </div>
              <div className="sm:w-[55%] aspect-[900/600] rounded-xl sm:rounded-2xl overflow-hidden bg-gray-100">
                <img
                  src="https://images.unsplash.com/photo-1519389950473-47ba0277781c?auto=format&fit=crop&w=1200&q=80"
                  alt="Telegram аутрич воронка Fracs"
                  className="w-full h-full object-cover"
                  loading="lazy"
                />
              </div>
            </div>
          </div>

          {/* Content area: DESKTOP (hidden lg:grid) */}
          <div className="hidden lg:grid grid-cols-[26%_1fr_48%] items-end gap-6 xl:gap-8 px-5 sm:px-8 lg:px-12">
            {/* Left column (self-end) */}
            <div className="self-end">
              <div className="aspect-[438/346] rounded-2xl overflow-hidden bg-gray-100">
                <img
                  src="https://images.unsplash.com/photo-1551288049-bebda4e38f71?auto=format&fit=crop&w=1200&q=80"
                  alt="Интерфейс парсинга 2ГИС Fracs"
                  className="w-full h-full object-cover"
                />
              </div>
            </div>

            {/* Center column (self-start, flex justify-end) */}
            <div className="self-start flex flex-col justify-end pt-2 pb-2">
              <p className="text-[16px] xl:text-[18px] leading-[1.65] font-medium text-gray-900 whitespace-nowrap mb-8">
                Fracs сканирует компании без сайтов в 2ГИС,
                <br />
                собирает прямые контакты лиц, принимающих решения,
                <br />
                и приводит готовых к сделке клиентов в ваш Telegram.
              </p>
              <div>
                <RollButton
                  text="Узнать алгоритм работы"
                  variant="orange"
                  size="md"
                  onClick={() => setLeadModalOpen(true)}
                />
              </div>
            </div>

            {/* Right column (self-end) */}
            <div className="self-end">
              <div className="aspect-[3/2] rounded-2xl overflow-hidden bg-gray-100">
                <img
                  src="https://images.unsplash.com/photo-1519389950473-47ba0277781c?auto=format&fit=crop&w=1200&q=80"
                  alt="Telegram аутрич воронка Fracs"
                  className="w-full h-full object-cover"
                />
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* =========================================================================
          SECTION 3: 2GIS LIVE SCANNER (Light gray background)
      ========================================================================= */}
      <section id="tools" className="bg-[#F5F5F5] pt-16 sm:pt-20 lg:pt-28 pb-16 sm:pb-20 lg:pb-28">
        <div className="max-w-[1440px] mx-auto">
          {/* Badge row */}
          <div className="px-5 sm:px-8 lg:px-12 flex items-center gap-3 mb-6 sm:mb-8">
            <span className="w-6 h-6 sm:w-7 sm:h-7 rounded-full bg-gray-900 text-white text-[11px] sm:text-[12px] font-semibold flex items-center justify-center shrink-0">
              2
            </span>
            <span className="text-[12px] sm:text-[13px] font-medium border border-gray-300 rounded-full px-3 sm:px-4 py-1 sm:py-1.5 text-gray-900 bg-white">
              Инструмент 1: Парсер 2ГИС
            </span>
          </div>

          {/* Heading */}
          <div className="px-5 sm:px-8 lg:px-12 mb-10 sm:mb-14 max-w-4xl">
            <h2 className="font-heading text-[clamp(1.75rem,5.5vw,3.6rem)] font-medium leading-[1.08] tracking-[-0.03em] text-gray-900 mb-4">
              Поиск прибыльных бизнесов без сайта на картах 2ГИС
            </h2>
            <p className="text-[15px] sm:text-[17px] text-gray-600 leading-relaxed">
              Тысячи офлайн-компаний зарабатывают миллионы, но не имеют сайта или онлайн-записи. Для них сайт, реклама или ваши услуги — это вопрос выживания. Мы находим таких клиентов первыми.
            </p>
          </div>

          {/* Interactive Scanner Box */}
          <div className="px-5 sm:px-8 lg:px-12">
            <div className="bg-white rounded-3xl p-6 sm:p-8 lg:p-10 shadow-sm border border-gray-200/80">
              {/* Filter controls */}
              <div className="flex flex-col lg:flex-row items-start lg:items-center justify-between gap-6 pb-8 border-b border-gray-100">
                <div className="flex flex-col gap-2 w-full lg:w-auto">
                  <span className="text-[12px] font-semibold text-gray-500 uppercase tracking-wider">
                    Выберите город:
                  </span>
                  <div className="flex flex-wrap gap-2">
                    {CITIES.map((city) => (
                      <button
                        key={city}
                        onClick={() => triggerScan(city, selectedNiche)}
                        className={`px-3.5 py-1.5 rounded-full text-[13px] font-medium transition-all cursor-pointer ${
                          selectedCity === city
                            ? 'bg-gray-900 text-white shadow-xs'
                            : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                        }`}
                      >
                        {city}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="flex flex-col gap-2 w-full lg:w-auto">
                  <span className="text-[12px] font-semibold text-gray-500 uppercase tracking-wider">
                    Выберите сферу бизнеса:
                  </span>
                  <div className="flex flex-wrap gap-2">
                    {NICHES.map((niche) => (
                      <button
                        key={niche}
                        onClick={() => triggerScan(selectedCity, niche)}
                        className={`px-3.5 py-1.5 rounded-full text-[13px] font-medium transition-all cursor-pointer ${
                          selectedNiche === niche
                            ? 'bg-[#F26522] text-white shadow-xs'
                            : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                        }`}
                      >
                        {niche}
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              {/* Stats Bar */}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4 sm:gap-6 py-8 border-b border-gray-100">
                <div className="bg-[#F9F9F9] p-4 sm:p-5 rounded-2xl">
                  <p className="text-[12px] text-gray-500 font-medium mb-1">Всего в 2ГИС по нише</p>
                  <p className="font-heading text-2xl sm:text-3xl font-semibold text-gray-900">
                    {isScanning ? '...' : `${totalFound}`}
                  </p>
                  <span className="text-[11px] text-gray-400">точек на карте</span>
                </div>

                <div className="bg-orange-50/80 p-4 sm:p-5 rounded-2xl border border-orange-100">
                  <p className="text-[12px] text-[#F26522] font-semibold mb-1">БЕЗ сайта (Горячие)</p>
                  <p className="font-heading text-2xl sm:text-3xl font-bold text-[#F26522]">
                    {isScanning ? '...' : `${withoutWebsite} (${percentWithoutWebsite}%)`}
                  </p>
                  <span className="text-[11px] text-orange-700/80">потенциальные клиенты</span>
                </div>

                <div className="bg-[#F9F9F9] p-4 sm:p-5 rounded-2xl">
                  <p className="text-[12px] text-gray-500 font-medium mb-1">Контактов ЛПР найдено</p>
                  <p className="font-heading text-2xl sm:text-3xl font-semibold text-gray-900">
                    {isScanning ? '...' : `${lprContactsFound}`}
                  </p>
                  <span className="text-[11px] text-emerald-600 font-medium">директора и владельцы</span>
                </div>

                <div className="bg-[#F9F9F9] p-4 sm:p-5 rounded-2xl">
                  <p className="text-[12px] text-gray-500 font-medium mb-1">Упущенная выручка</p>
                  <p className="font-heading text-2xl sm:text-3xl font-semibold text-gray-900">
                    ~1.8 млн ₽
                  </p>
                  <span className="text-[11px] text-gray-400">в среднем на точку</span>
                </div>
              </div>

              {/* Sample Scanned Businesses Preview */}
              <div className="pt-6">
                <div className="flex items-center justify-between mb-4">
                  <h3 className="font-heading text-lg font-medium text-gray-900 flex items-center gap-2">
                    <span>Пример выборки 2ГИС для города {selectedCity}</span>
                    <span className="text-[11px] font-normal text-emerald-600 bg-emerald-50 px-2 py-0.5 rounded-full border border-emerald-100 flex items-center gap-1">
                      <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                      База обновлена сегодня
                    </span>
                  </h3>
                  <button
                    onClick={() => setLeadModalOpen(true)}
                    className="text-[13px] font-medium text-[#F26522] hover:text-[#e05a1a] flex items-center gap-1 transition-colors cursor-pointer"
                  >
                    <span>Выгрузить всю базу ({withoutWebsite})</span>
                    <ArrowRight className="w-3.5 h-3.5" />
                  </button>
                </div>

                <div className="space-y-3">
                  {sampleBusinesses.map((b) => (
                    <div
                      key={b.id}
                      className="flex flex-col md:flex-row items-start md:items-center justify-between p-4 rounded-2xl border border-gray-100 hover:border-gray-300 hover:bg-gray-50/60 transition-all gap-4"
                    >
                      <div className="flex items-start gap-3.5">
                        <div className="w-10 h-10 rounded-xl bg-gray-100 flex items-center justify-center shrink-0 text-gray-700">
                          <Building2 className="w-5 h-5" />
                        </div>
                        <div>
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="font-semibold text-gray-900 text-[15px]">
                              {b.name}
                            </span>
                            <span className="text-[12px] text-amber-600 font-medium bg-amber-50 px-2 py-0.5 rounded">
                              ★ {b.rating} ({b.reviewsCount} отзывов в 2ГИС)
                            </span>
                            <span className="text-[11px] font-semibold text-red-600 bg-red-50 border border-red-100 px-2 py-0.5 rounded-full flex items-center gap-1">
                              <AlertCircle className="w-3 h-3" />
                              Сайт отсутствует
                            </span>
                          </div>
                          <p className="text-[13px] text-gray-500 mt-1 flex items-center gap-1">
                            <MapPin className="w-3.5 h-3.5 text-gray-400 shrink-0" />
                            {b.address}
                          </p>
                        </div>
                      </div>

                      <div className="flex items-center gap-3 w-full md:w-auto justify-between md:justify-end border-t md:border-t-0 pt-3 md:pt-0 border-gray-100">
                        <div className="text-right">
                          <p className="text-[12px] font-medium text-gray-900">
                            {b.decisionMaker}
                          </p>
                          <p className="text-[11px] text-gray-400 font-mono">
                            {b.phoneMasked}
                          </p>
                        </div>
                        <button
                          onClick={() => setLeadModalOpen(true)}
                          className="px-3.5 py-1.5 text-[12px] font-medium bg-gray-900 hover:bg-black text-white rounded-lg transition-colors cursor-pointer shrink-0"
                        >
                          Открыть контакт
                        </button>
                      </div>
                    </div>
                  ))}
                </div>

                {/* Bottom banner in card */}
                <div className="mt-6 p-4 rounded-2xl bg-orange-50/60 border border-orange-100 flex flex-col sm:flex-row items-center justify-between gap-4">
                  <div className="flex items-center gap-3">
                    <Sparkles className="w-5 h-5 text-[#F26522] shrink-0" />
                    <p className="text-[13px] text-gray-700 leading-snug">
                      Хотите получить бесплатную тестовую выгрузку <strong>20 компаний без сайтов</strong> в вашем регионе с прямыми номерами ЛПР?
                    </p>
                  </div>
                  <RollButton
                    text="Скачать тестовую базу"
                    variant="orange"
                    size="sm"
                    onClick={() => setLeadModalOpen(true)}
                  />
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* =========================================================================
          SECTION 4: TELEGRAM ENGINE & OUTREACH (White background)
      ========================================================================= */}
      <section id="telegram" className="bg-white pt-16 sm:pt-20 lg:pt-28 pb-16 sm:pb-20 lg:pb-28">
        <div className="max-w-[1440px] mx-auto">
          {/* Badge row */}
          <div className="px-5 sm:px-8 lg:px-12 flex items-center gap-3 mb-6 sm:mb-8">
            <span className="w-6 h-6 sm:w-7 sm:h-7 rounded-full bg-gray-900 text-white text-[11px] sm:text-[12px] font-semibold flex items-center justify-center shrink-0">
              3
            </span>
            <span className="text-[12px] sm:text-[13px] font-medium border border-gray-200 rounded-full px-3 sm:px-4 py-1 sm:py-1.5 text-gray-900">
              Инструмент 2: Telegram Парсер & Аутрич
            </span>
          </div>

          {/* Heading */}
          <div className="px-5 sm:px-8 lg:px-12 mb-12 sm:mb-16 max-w-4xl">
            <h2 className="font-heading text-[clamp(1.75rem,5.5vw,3.6rem)] font-medium leading-[1.08] tracking-[-0.03em] text-gray-900 mb-4">
              Прямой диалог с лицом, принимающим решения, прямо в мессенджере
            </h2>
            <p className="text-[15px] sm:text-[17px] text-gray-600 leading-relaxed">
              Холодные звонки блокируют секретари, а спам на почту никто не читает. Telegram — это личное пространство собственника с открываемостью сообщений свыше 85%.
            </p>
          </div>

          {/* 4 Steps Grid */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 px-5 sm:px-8 lg:px-12 mb-14">
            <div className="p-6 sm:p-7 rounded-2xl bg-[#F9F9F9] border border-gray-100 flex flex-col justify-between hover:shadow-sm transition-shadow">
              <div>
                <div className="w-10 h-10 rounded-xl bg-orange-100 text-[#F26522] flex items-center justify-center font-bold text-sm mb-5">
                  01
                </div>
                <h3 className="font-heading text-lg font-semibold text-gray-900 mb-2">
                  Парсинг чатов и каналов
                </h3>
                <p className="text-[13px] sm:text-[14px] text-gray-600 leading-relaxed">
                  Сканируем более 15 000 отраслевых чатов, закрытых сообществ и каналов конкурентов по ключевым словам вашей ниши.
                </p>
              </div>
              <div className="pt-6 mt-4 border-t border-gray-200/60 flex items-center gap-2 text-[12px] text-gray-500">
                <Database className="w-4 h-4 text-gray-400" />
                <span>Глубокий сбор ID</span>
              </div>
            </div>

            <div className="p-6 sm:p-7 rounded-2xl bg-[#F9F9F9] border border-gray-100 flex flex-col justify-between hover:shadow-sm transition-shadow">
              <div>
                <div className="w-10 h-10 rounded-xl bg-orange-100 text-[#F26522] flex items-center justify-center font-bold text-sm mb-5">
                  02
                </div>
                <h3 className="font-heading text-lg font-semibold text-gray-900 mb-2">
                  AI-фильтрация ЛПР
                </h3>
                <p className="text-[13px] sm:text-[14px] text-gray-600 leading-relaxed">
                  Исключаем ботов, накрутку и рядовых сотрудников. Сопоставляем профили с реестрами ЕГРЮЛ и данными 2ГИС.
                </p>
              </div>
              <div className="pt-6 mt-4 border-t border-gray-200/60 flex items-center gap-2 text-[12px] text-gray-500">
                <Filter className="w-4 h-4 text-gray-400" />
                <span>Только реальные директора</span>
              </div>
            </div>

            <div className="p-6 sm:p-7 rounded-2xl bg-[#F9F9F9] border border-gray-100 flex flex-col justify-between hover:shadow-sm transition-shadow">
              <div>
                <div className="w-10 h-10 rounded-xl bg-orange-100 text-[#F26522] flex items-center justify-center font-bold text-sm mb-5">
                  03
                </div>
                <h3 className="font-heading text-lg font-semibold text-gray-900 mb-2">
                  Персональный оффер
                </h3>
                <p className="text-[13px] sm:text-[14px] text-gray-600 leading-relaxed">
                  Пишем не шаблонный спам, а конкретное предложение с упоминанием компании клиента и точек роста их выручки.
                </p>
              </div>
              <div className="pt-6 mt-4 border-t border-gray-200/60 flex items-center gap-2 text-[12px] text-gray-500">
                <Send className="w-4 h-4 text-gray-400" />
                <span>Конверсия в ответ 24.6%</span>
              </div>
            </div>

            <div className="p-6 sm:p-7 rounded-2xl bg-[#F9F9F9] border border-gray-100 flex flex-col justify-between hover:shadow-sm transition-shadow">
              <div>
                <div className="w-10 h-10 rounded-xl bg-orange-100 text-[#F26522] flex items-center justify-center font-bold text-sm mb-5">
                  04
                </div>
                <h3 className="font-heading text-lg font-semibold text-gray-900 mb-2">
                  Перевод в диалог и CRM
                </h3>
                <p className="text-[13px] sm:text-[14px] text-gray-600 leading-relaxed">
                  Как только ЛПР подтверждает интерес, контакт мгновенно передается вашему менеджеру или падает лидом в CRM.
                </p>
              </div>
              <div className="pt-6 mt-4 border-t border-gray-200/60 flex items-center gap-2 text-[12px] text-gray-500">
                <PhoneCall className="w-4 h-4 text-gray-400" />
                <span>Готовность к встрече</span>
              </div>
            </div>
          </div>

          {/* High-res Image Banner with metrics overlay */}
          <div className="px-5 sm:px-8 lg:px-12">
            <div className="relative rounded-3xl overflow-hidden aspect-[21/9] min-h-[300px] bg-gray-900">
              <img
                src="https://images.unsplash.com/photo-1551836022-d5d88e9218df?auto=format&fit=crop&w=1400&q=80"
                alt="Fracs автоматизация работы отдела продаж"
                className="w-full h-full object-cover opacity-60"
              />
              <div className="absolute inset-0 bg-gradient-to-r from-gray-950/90 via-gray-950/60 to-transparent p-6 sm:p-10 lg:p-14 flex flex-col justify-between">
                <div className="max-w-xl">
                  <span className="text-[11px] font-semibold text-[#F26522] uppercase tracking-wider bg-[#F26522]/10 border border-[#F26522]/30 px-3 py-1 rounded-full">
                    Безопасная экосистема
                  </span>
                  <h3 className="font-heading text-2xl sm:text-3xl lg:text-4xl font-medium text-white mt-4 mb-3">
                    0% риска блокировок. Полная автономность.
                  </h3>
                  <p className="text-[14px] sm:text-[15px] text-gray-300 leading-relaxed">
                    Мы берем на себя инфраструктуру: домены, выделенные мобильные прокси и согретые аккаунты. Вы получаете исключительно готовых к созвону лидов.
                  </p>
                </div>

                <div className="flex flex-wrap gap-4 sm:gap-6 pt-6">
                  <div className="flex items-center gap-2 bg-white/10 backdrop-blur-md px-4 py-2 rounded-xl border border-white/10 text-white text-[13px]">
                    <ShieldCheck className="w-4 h-4 text-[#F26522]" />
                    <span>ФЗ-152 Безопасно</span>
                  </div>
                  <div className="flex items-center gap-2 bg-white/10 backdrop-blur-md px-4 py-2 rounded-xl border border-white/10 text-white text-[13px]">
                    <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                    <span>Интеграция с amoCRM / Битрикс</span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* =========================================================================
          SECTION 5: CASE STUDIES (Light gray background)
      ========================================================================= */}
      <section id="projects" className="bg-[#F5F5F5] pt-16 sm:pt-20 lg:pt-28 pb-16 sm:pb-20 lg:pb-28">
        <div className="max-w-[1440px] mx-auto">
          {/* Badge row */}
          <div className="px-5 sm:px-8 lg:px-12 flex items-center gap-3 mb-6 sm:mb-8">
            <span className="w-6 h-6 sm:w-7 sm:h-7 rounded-full bg-gray-900 text-white text-[11px] sm:text-[12px] font-semibold flex items-center justify-center shrink-0">
              4
            </span>
            <span className="text-[12px] sm:text-[13px] font-medium border border-gray-300 rounded-full px-3 sm:px-4 py-1 sm:py-1.5 text-gray-900 bg-white">
              Результаты клиентов
            </span>
          </div>

          {/* Heading h2 */}
          <h2 className="font-heading text-[clamp(1.75rem,7vw,4.2rem)] sm:text-[clamp(2.5rem,5vw,4.2rem)] font-medium leading-[1.08] tracking-[-0.03em] text-gray-900 mb-10 sm:mb-14 lg:mb-16 px-5 sm:px-8 lg:px-12">
            Наши кейсы
          </h2>

          {/* Cards Grid */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-5 sm:gap-6 lg:gap-7 px-5 sm:px-8 lg:px-12">
            {/* Card 1 (Парсинг 2ГИС: Компании без сайтов) */}
            <article
              className="flex flex-col cursor-pointer"
              onClick={() => setLeadModalOpen(true)}
            >
              {/* Video container */}
              <div className="aspect-[329/246] rounded-2xl overflow-hidden bg-[#1a1d2e] relative group shadow-sm">
                <video
                  src="https://d8j0ntlcm91z4.cloudfront.net/user_38xzZboKViGWJOttwIXH07lWA1P/hf_20260516_122702_390f5305-8719-41d5-ae80-d23ab3796c28.mp4"
                  autoPlay
                  muted
                  loop
                  playsInline
                  className="w-full h-full object-cover"
                />

                {/* Hover button */}
                <div className="absolute bottom-4 left-4 h-9 w-9 bg-white rounded-full flex items-center justify-between px-2.5 overflow-hidden transition-all duration-300 ease-in-out group-hover:w-[158px] shadow-md pointer-events-none">
                  <span className="text-[13px] font-medium text-gray-900 whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity duration-300 delay-100 pl-1">
                    Изучить кейс
                  </span>
                  <div className="shrink-0 transition-transform duration-300 ease-in-out -rotate-45 group-hover:rotate-0 text-gray-900">
                    <ChainLinkIcon />
                  </div>
                </div>
              </div>

              {/* Description */}
              <p className="text-[13px] sm:text-[14px] text-gray-600 mt-4 leading-relaxed">
                148 горячих B2B-заявок за 10 дней: умная фильтрация компаний без сайта в 2ГИС с персонализированным оффером в Telegram
              </p>

              {/* Title */}
              <h3 className="font-heading text-[15px] sm:text-[16px] font-semibold text-gray-900 mt-1">
                Кейс: Веб-агентство и автоматизация
              </h3>
            </article>

            {/* Card 2 (Telegram аутрич парсер) */}
            <article
              className="flex flex-col cursor-pointer"
              onClick={() => setLeadModalOpen(true)}
            >
              {/* Video container */}
              <div className="aspect-square rounded-2xl overflow-hidden bg-[#6b6b6b] relative group shadow-sm">
                <video
                  src="https://d8j0ntlcm91z4.cloudfront.net/user_38xzZboKViGWJOttwIXH07lWA1P/hf_20260516_123323_f909c2b8-ff6c-4edf-882b-8ebcdbe389b5.mp4"
                  autoPlay
                  muted
                  loop
                  playsInline
                  className="w-full h-full object-cover"
                />

                {/* Hover button */}
                <div className="absolute bottom-4 left-4 bg-gray-900 h-9 w-9 rounded-full flex items-center justify-between px-2.5 overflow-hidden transition-all duration-300 ease-in-out group-hover:w-[172px] shadow-md pointer-events-none">
                  <span className="text-[13px] font-medium text-white whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity duration-300 delay-100 pl-1">
                    Смотреть воронку
                  </span>
                  <div className="shrink-0 transition-transform duration-300 ease-in-out -rotate-45 group-hover:rotate-0 text-white">
                    <ArrowRight className="w-3.5 h-3.5" />
                  </div>
                </div>
              </div>

              {/* Description */}
              <p className="text-[13px] sm:text-[14px] text-gray-600 mt-4 leading-relaxed">
                340+ прямых созвонов с собственниками бизнеса через Telegram-парсер с рекордной конверсией в продажу 18.4%
              </p>

              {/* Title */}
              <h3 className="font-heading text-[15px] sm:text-[16px] font-semibold text-gray-900 mt-1">
                Кейс: Оптовые поставки и производство
              </h3>
            </article>
          </div>
        </div>
      </section>

      {/* =========================================================================
          SECTION 6: ROI CALCULATOR (White background)
      ========================================================================= */}
      <section id="calculator" className="bg-white pt-16 sm:pt-20 lg:pt-28 pb-16 sm:pb-20 lg:pb-28">
        <div className="max-w-[1440px] mx-auto">
          {/* Badge row */}
          <div className="px-5 sm:px-8 lg:px-12 flex items-center gap-3 mb-6 sm:mb-8">
            <span className="w-6 h-6 sm:w-7 sm:h-7 rounded-full bg-gray-900 text-white text-[11px] sm:text-[12px] font-semibold flex items-center justify-center shrink-0">
              5
            </span>
            <span className="text-[12px] sm:text-[13px] font-medium border border-gray-200 rounded-full px-3 sm:px-4 py-1 sm:py-1.5 text-gray-900">
              Экономика и ROI
            </span>
          </div>

          <div className="px-5 sm:px-8 lg:px-12 mb-12 max-w-4xl">
            <h2 className="font-heading text-[clamp(1.75rem,5.5vw,3.6rem)] font-medium leading-[1.08] tracking-[-0.03em] text-gray-900 mb-4">
              Посчитайте выгоду по сравнению с контекстной рекламой
            </h2>
            <p className="text-[15px] sm:text-[17px] text-gray-600 leading-relaxed">
              В Яндекс Директ стоимость одного лида в B2B часто превышает 3 000–5 000 ₽. Во Fracs вы получаете прямой контакт с ЛПР по фиксированной цене без оплаты за клики и скликивания.
            </p>
          </div>

          <div className="px-5 sm:px-8 lg:px-12">
            <div className="bg-[#F9F9F9] rounded-3xl p-6 sm:p-10 border border-gray-200/70 grid grid-cols-1 lg:grid-cols-12 gap-8 items-center">
              {/* Sliders column */}
              <div className="lg:col-span-7 space-y-8">
                <div>
                  <div className="flex justify-between items-center mb-2">
                    <label className="text-[14px] font-semibold text-gray-800">
                      Сколько лидов в месяц вам нужно:
                    </label>
                    <span className="font-heading text-xl font-bold text-[#F26522]">
                      {leadsCount} лидов
                    </span>
                  </div>
                  <input
                    type="range"
                    min="30"
                    max="500"
                    step="10"
                    value={leadsCount}
                    onChange={(e) => setLeadsCount(Number(e.target.value))}
                    className="w-full accent-[#F26522] cursor-pointer"
                  />
                  <div className="flex justify-between text-[11px] text-gray-400 mt-1">
                    <span>30 лидов (тест)</span>
                    <span>250 лидов</span>
                    <span>500 лидов (масштаб)</span>
                  </div>
                </div>

                <div>
                  <div className="flex justify-between items-center mb-2">
                    <label className="text-[14px] font-semibold text-gray-800">
                      Средний чек вашей сделки:
                    </label>
                    <span className="font-heading text-xl font-bold text-gray-900">
                      {averageCheck.toLocaleString('ru-RU')} ₽
                    </span>
                  </div>
                  <input
                    type="range"
                    min="30000"
                    max="1000000"
                    step="10000"
                    value={averageCheck}
                    onChange={(e) => setAverageCheck(Number(e.target.value))}
                    className="w-full accent-[#F26522] cursor-pointer"
                  />
                  <div className="flex justify-between text-[11px] text-gray-400 mt-1">
                    <span>30 000 ₽</span>
                    <span>500 000 ₽</span>
                    <span>1 000 000 ₽</span>
                  </div>
                </div>

                <div>
                  <div className="flex justify-between items-center mb-2">
                    <label className="text-[14px] font-semibold text-gray-800">
                      Конверсия отдела продаж в оплату:
                    </label>
                    <span className="font-heading text-xl font-bold text-gray-900">
                      {conversionRate}%
                    </span>
                  </div>
                  <input
                    type="range"
                    min="5"
                    max="30"
                    step="1"
                    value={conversionRate}
                    onChange={(e) => setConversionRate(Number(e.target.value))}
                    className="w-full accent-[#F26522] cursor-pointer"
                  />
                  <div className="flex justify-between text-[11px] text-gray-400 mt-1">
                    <span>5% (холодный отдел)</span>
                    <span>15% (средняя)</span>
                    <span>30% (топ менеджеры)</span>
                  </div>
                </div>
              </div>

              {/* Calculation card */}
              <div className="lg:col-span-5 bg-white p-6 sm:p-8 rounded-2xl shadow-sm border border-gray-200">
                <span className="text-[11px] font-semibold tracking-wider uppercase text-emerald-600 bg-emerald-50 px-2.5 py-1 rounded">
                  Прогноз окупаемости
                </span>

                <div className="mt-5 space-y-4 pb-6 border-b border-gray-100">
                  <div className="flex justify-between text-[14px]">
                    <span className="text-gray-500">Стоимость рекламы в Яндекс:</span>
                    <span className="font-medium text-gray-500 line-through">
                      {directAdsCost.toLocaleString('ru-RU')} ₽
                    </span>
                  </div>
                  <div className="flex justify-between text-[14px]">
                    <span className="text-gray-800 font-medium">Стоимость во Fracs:</span>
                    <span className="font-bold text-gray-900">
                      {fracsCost.toLocaleString('ru-RU')} ₽
                    </span>
                  </div>
                  <div className="flex justify-between text-[15px] pt-1">
                    <span className="text-emerald-700 font-semibold">Ваша экономия бюджета:</span>
                    <span className="font-heading font-bold text-emerald-600 text-lg">
                      +{savedBudget.toLocaleString('ru-RU')} ₽
                    </span>
                  </div>
                </div>

                <div className="pt-5 pb-6">
                  <p className="text-[12px] text-gray-500 mb-1">Прогноз выручки с новых клиентов:</p>
                  <p className="font-heading text-3xl font-bold text-gray-900">
                    ~{projectedRevenue.toLocaleString('ru-RU')} ₽
                  </p>
                  <p className="text-[12px] text-gray-500 mt-1">
                    При закрытии {closedDeals} {closedDeals === 1 ? 'сделки' : 'сделок'} с чеком {averageCheck.toLocaleString('ru-RU')} ₽
                  </p>
                </div>

                <RollButton
                  text="Зафиксировать эти условия"
                  variant="orange"
                  size="md"
                  className="w-full justify-between"
                  onClick={() => setLeadModalOpen(true)}
                />
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* =========================================================================
          SECTION 7: PRICING (Light gray background)
      ========================================================================= */}
      <section id="pricing" className="bg-[#F5F5F5] pt-16 sm:pt-20 lg:pt-28 pb-16 sm:pb-20 lg:pb-28">
        <div className="max-w-[1440px] mx-auto">
          {/* Badge row */}
          <div className="px-5 sm:px-8 lg:px-12 flex items-center gap-3 mb-6 sm:mb-8">
            <span className="w-6 h-6 sm:w-7 sm:h-7 rounded-full bg-gray-900 text-white text-[11px] sm:text-[12px] font-semibold flex items-center justify-center shrink-0">
              6
            </span>
            <span className="text-[12px] sm:text-[13px] font-medium border border-gray-300 rounded-full px-3 sm:px-4 py-1 sm:py-1.5 text-gray-900 bg-white">
              Тарифы под ключ
            </span>
          </div>

          <div className="px-5 sm:px-8 lg:px-12 mb-12 max-w-4xl">
            <h2 className="font-heading text-[clamp(1.75rem,5.5vw,3.6rem)] font-medium leading-[1.08] tracking-[-0.03em] text-gray-900 mb-4">
              Прозрачные тарифы без скрытых платежей
            </h2>
            <p className="text-[15px] sm:text-[17px] text-gray-600 leading-relaxed">
              Выбирайте формат: единоразовая выгрузка горячей базы или регулярный автоматический поток квалифицированных лидов под ключ.
            </p>
          </div>

          {/* Pricing Cards */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 px-5 sm:px-8 lg:px-12">
            {/* Plan 1 */}
            <div className="bg-white rounded-3xl p-7 sm:p-8 border border-gray-200/80 flex flex-col justify-between">
              <div>
                <span className="text-[11px] font-semibold uppercase tracking-wider text-gray-600 bg-gray-100 px-3 py-1 rounded-full">
                  Для своего отдела
                </span>
                <h3 className="font-heading text-2xl font-semibold text-gray-900 mt-4 mb-2">
                  База 2ГИС: Без сайтов
                </h3>
                <p className="text-[13px] text-gray-600 leading-relaxed mb-6">
                  Идеально, если у вас уже есть менеджеры, готовые сразу звонить и закрывать сделки по готовой выборке.
                </p>

                <div className="mb-6">
                  <span className="font-heading text-3xl sm:text-4xl font-bold text-gray-900">
                    24 900 ₽
                  </span>
                  <span className="text-gray-500 text-sm ml-2">/ разово</span>
                </div>

                <ul className="space-y-3 text-[13px] text-gray-700">
                  <li className="flex items-center gap-2.5">
                    <CheckCircle2 className="w-4 h-4 text-emerald-500 shrink-0" />
                    <span>До 1 000 проверенных компаний без сайта</span>
                  </li>
                  <li className="flex items-center gap-2.5">
                    <CheckCircle2 className="w-4 h-4 text-emerald-500 shrink-0" />
                    <span>Прямые контакты ЛПР и владельцев</span>
                  </li>
                  <li className="flex items-center gap-2.5">
                    <CheckCircle2 className="w-4 h-4 text-emerald-500 shrink-0" />
                    <span>Выгрузка в Excel / Google Таблицы</span>
                  </li>
                  <li className="flex items-center gap-2.5">
                    <CheckCircle2 className="w-4 h-4 text-emerald-500 shrink-0" />
                    <span>Готовые скрипты звонка под вашу нишу</span>
                  </li>
                </ul>
              </div>

              <div className="pt-8 mt-6 border-t border-gray-100">
                <RollButton
                  text="Выбрать тариф База"
                  variant="outline"
                  size="md"
                  className="w-full justify-between"
                  onClick={() => setLeadModalOpen(true)}
                />
              </div>
            </div>

            {/* Plan 2 (Featured) */}
            <div className="bg-gray-900 text-white rounded-3xl p-7 sm:p-8 shadow-xl flex flex-col justify-between relative border-2 border-[#F26522]">
              <div className="absolute -top-3.5 right-8 bg-[#F26522] text-white text-[11px] font-semibold px-3 py-1 rounded-full uppercase tracking-wider">
                Хит продаж
              </div>

              <div>
                <span className="text-[11px] font-semibold uppercase tracking-wider text-[#F26522] bg-white/10 px-3 py-1 rounded-full">
                  Все включено
                </span>
                <h3 className="font-heading text-2xl font-semibold text-white mt-4 mb-2">
                  2ГИС + Telegram Аутрич
                </h3>
                <p className="text-[13px] text-gray-300 leading-relaxed mb-6">
                  Полная автоматизация: мы находим компании и сами приводим заинтересованных клиентов в ваш диалог.
                </p>

                <div className="mb-6">
                  <span className="font-heading text-3xl sm:text-4xl font-bold text-white">
                    69 000 ₽
                  </span>
                  <span className="text-gray-400 text-sm ml-2">/ месяц</span>
                </div>

                <ul className="space-y-3 text-[13px] text-gray-200">
                  <li className="flex items-center gap-2.5">
                    <CheckCircle2 className="w-4 h-4 text-[#F26522] shrink-0" />
                    <span>Парсинг 2ГИС + закрытых Telegram-сообществ</span>
                  </li>
                  <li className="flex items-center gap-2.5">
                    <CheckCircle2 className="w-4 h-4 text-[#F26522] shrink-0" />
                    <span>Настройка фермы аккаунтов и безопасных прокси</span>
                  </li>
                  <li className="flex items-center gap-2.5">
                    <CheckCircle2 className="w-4 h-4 text-[#F26522] shrink-0" />
                    <span>От 80 до 150 теплых квалифицированных диалогов</span>
                  </li>
                  <li className="flex items-center gap-2.5">
                    <CheckCircle2 className="w-4 h-4 text-[#F26522] shrink-0" />
                    <span>Интеграция с вашей CRM и мгновенные пуши</span>
                  </li>
                  <li className="flex items-center gap-2.5">
                    <CheckCircle2 className="w-4 h-4 text-[#F26522] shrink-0" />
                    <span>Фиксация плана лидов по договору</span>
                  </li>
                </ul>
              </div>

              <div className="pt-8 mt-6 border-t border-white/10">
                <RollButton
                  text="Подключить комплекс"
                  variant="orange"
                  size="md"
                  className="w-full justify-between"
                  onClick={() => setLeadModalOpen(true)}
                />
              </div>
            </div>

            {/* Plan 3 */}
            <div className="bg-white rounded-3xl p-7 sm:p-8 border border-gray-200/80 flex flex-col justify-between">
              <div>
                <span className="text-[11px] font-semibold uppercase tracking-wider text-gray-600 bg-gray-100 px-3 py-1 rounded-full">
                  Для крупных B2B
                </span>
                <h3 className="font-heading text-2xl font-semibold text-gray-900 mt-4 mb-2">
                  Отдел продаж под ключ
                </h3>
                <p className="text-[13px] text-gray-600 leading-relaxed mb-6">
                  Индивидуальная стратегия, персональный маркетолог и выделенная команда аутрича для захвата всей ниши.
                </p>

                <div className="mb-6">
                  <span className="font-heading text-3xl sm:text-4xl font-bold text-gray-900">
                    139 000 ₽
                  </span>
                  <span className="text-gray-500 text-sm ml-2">/ месяц</span>
                </div>

                <ul className="space-y-3 text-[13px] text-gray-700">
                  <li className="flex items-center gap-2.5">
                    <CheckCircle2 className="w-4 h-4 text-emerald-500 shrink-0" />
                    <span>Неограниченный парсинг всех городов РФ</span>
                  </li>
                  <li className="flex items-center gap-2.5">
                    <CheckCircle2 className="w-4 h-4 text-emerald-500 shrink-0" />
                    <span>300+ целевых созвонов в месяц</span>
                  </li>
                  <li className="flex items-center gap-2.5">
                    <CheckCircle2 className="w-4 h-4 text-emerald-500 shrink-0" />
                    <span>A/B тесты офферов и цепочек сообщений</span>
                  </li>
                  <li className="flex items-center gap-2.5">
                    <CheckCircle2 className="w-4 h-4 text-emerald-500 shrink-0" />
                    <span>Персональный аккаунт-менеджер 24/7</span>
                  </li>
                </ul>
              </div>

              <div className="pt-8 mt-6 border-t border-gray-100">
                <RollButton
                  text="Обсудить условия"
                  variant="outline"
                  size="md"
                  className="w-full justify-between"
                  onClick={() => setLeadModalOpen(true)}
                />
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* =========================================================================
          SECTION 8: FAQ ACCORDION (White background)
      ========================================================================= */}
      <section id="faq" className="bg-white pt-16 sm:pt-20 lg:pt-28 pb-16 sm:pb-20 lg:pb-28">
        <div className="max-w-[1440px] mx-auto">
          {/* Badge row */}
          <div className="px-5 sm:px-8 lg:px-12 flex items-center gap-3 mb-6 sm:mb-8">
            <span className="w-6 h-6 sm:w-7 sm:h-7 rounded-full bg-gray-900 text-white text-[11px] sm:text-[12px] font-semibold flex items-center justify-center shrink-0">
              7
            </span>
            <span className="text-[12px] sm:text-[13px] font-medium border border-gray-200 rounded-full px-3 sm:px-4 py-1 sm:py-1.5 text-gray-900">
              Частые вопросы
            </span>
          </div>

          <div className="px-5 sm:px-8 lg:px-12 mb-12 max-w-4xl">
            <h2 className="font-heading text-[clamp(1.75rem,5.5vw,3.6rem)] font-medium leading-[1.08] tracking-[-0.03em] text-gray-900 mb-4">
              Всё, что важно знать перед запуском
            </h2>
            <p className="text-[15px] sm:text-[17px] text-gray-600 leading-relaxed">
              Ответы на ключевые вопросы о безопасности, юридической чистоте и механике работы сервиса Fracs.
            </p>
          </div>

          {/* Accordion list */}
          <div className="px-5 sm:px-8 lg:px-12 max-w-4xl space-y-4">
            {faqs.map((faq, index) => {
              const isOpen = openFaqIndex === index;
              return (
                <div
                  key={faq.question}
                  className="rounded-2xl border border-gray-200/80 overflow-hidden transition-colors"
                >
                  <button
                    onClick={() => setOpenFaqIndex(isOpen ? null : index)}
                    className="w-full p-5 sm:p-6 text-left flex items-center justify-between gap-4 cursor-pointer hover:bg-gray-50/70 transition-colors"
                  >
                    <span className="font-heading text-[16px] sm:text-[18px] font-medium text-gray-900">
                      {faq.question}
                    </span>
                    <ChevronDown
                      className={`w-5 h-5 text-gray-500 shrink-0 transition-transform duration-300 ${
                        isOpen ? 'rotate-180 text-[#F26522]' : ''
                      }`}
                    />
                  </button>

                  {isOpen && (
                    <div className="px-5 sm:px-6 pb-6 pt-1 text-[14px] sm:text-[15px] text-gray-600 leading-relaxed border-t border-gray-100 bg-gray-50/30">
                      {faq.answer}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </section>

      {/* =========================================================================
          SECTION 9: FOOTER (Dark)
      ========================================================================= */}
      <footer className="bg-gray-950 text-white pt-16 sm:pt-20 pb-12 border-t border-gray-900">
        <div className="max-w-[1440px] mx-auto px-5 sm:px-8 lg:px-12">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-10 pb-14 border-b border-gray-800">
            {/* Brand column */}
            <div className="lg:col-span-2">
              <div className="flex items-center gap-3 mb-4">
                <div className="w-9 h-9 bg-white text-gray-950 rounded-full flex items-center justify-center font-bold text-xs font-heading">
                  FR
                </div>
                <span className="font-heading text-xl font-semibold tracking-tight">
                  Fracs LeadGen
                </span>
              </div>
              <p className="text-[13px] sm:text-[14px] text-gray-400 max-w-sm leading-relaxed mb-6">
                Автоматизированная платформа поиска платежеспособных B2B-клиентов на картах 2ГИС и прямого аутрича в Telegram без рекламного бюджета.
              </p>
              <div className="flex items-center gap-2 text-[12px] text-gray-400">
                <Clock className="w-3.5 h-3.5 text-gray-500" />
                <span>Время штаб-квартиры: {moscowTime} МСК</span>
              </div>
            </div>

            {/* Links 1 */}
            <div>
              <p className="font-heading text-sm font-semibold uppercase tracking-wider text-gray-300 mb-4">
                Инструменты
              </p>
              <ul className="space-y-2.5 text-[13px] text-gray-400">
                <li>
                  <a href="#tools" className="hover:text-white transition-colors">
                    Сканер 2ГИС без сайта
                  </a>
                </li>
                <li>
                  <a href="#telegram" className="hover:text-white transition-colors">
                    Telegram Парсер
                  </a>
                </li>
                <li>
                  <a href="#calculator" className="hover:text-white transition-colors">
                    Калькулятор ROI
                  </a>
                </li>
                <li>
                  <a href="#pricing" className="hover:text-white transition-colors">
                    Тарифные планы
                  </a>
                </li>
              </ul>
            </div>

            {/* Links 2 */}
            <div>
              <p className="font-heading text-sm font-semibold uppercase tracking-wider text-gray-300 mb-4">
                О сервисе
              </p>
              <ul className="space-y-2.5 text-[13px] text-gray-400">
                <li>
                  <a href="#about" className="hover:text-white transition-colors">
                    Технология Fracs
                  </a>
                </li>
                <li>
                  <a href="#projects" className="hover:text-white transition-colors">
                    Кейсы клиентов
                  </a>
                </li>
                <li>
                  <a href="#faq" className="hover:text-white transition-colors">
                    Частые вопросы
                  </a>
                </li>
                <li>
                  <button
                    onClick={() => setLeadModalOpen(true)}
                    className="hover:text-white transition-colors cursor-pointer text-left"
                  >
                    Бесплатный тест-драйв
                  </button>
                </li>
              </ul>
            </div>

            {/* Contacts */}
            <div>
              <p className="font-heading text-sm font-semibold uppercase tracking-wider text-gray-300 mb-4">
                Связаться с нами
              </p>
              <p className="text-[13px] text-gray-400 mb-2">
                Telegram: <span className="text-white font-medium">@fracs_lead</span>
              </p>
              <p className="text-[13px] text-gray-400 mb-4">
                Email: <span className="text-white font-medium">hello@fracs.io</span>
              </p>
              <RollButton
                text="Написать в Telegram"
                variant="orange"
                size="sm"
                onClick={() => setLeadModalOpen(true)}
              />
            </div>
          </div>

          <div className="pt-8 flex flex-col sm:flex-row items-center justify-between text-[12px] text-gray-500 gap-4">
            <p>© 2026 Fracs LeadGen Platform. Все права защищены.</p>
            <div className="flex gap-6">
              <span className="hover:text-gray-400 cursor-pointer">Политика конфиденциальности</span>
              <span className="hover:text-gray-400 cursor-pointer">Договор оферты</span>
              <span className="hover:text-gray-400 cursor-pointer">Согласие на обработку данных</span>
            </div>
          </div>
        </div>
      </footer>

      {/* Lead Generation Request Modal */}
      {leadModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div
            onClick={() => setLeadModalOpen(false)}
            className="absolute inset-0 bg-black/60 backdrop-blur-xs transition-opacity duration-300"
          />

          <div className="relative z-10 bg-white rounded-2xl w-full max-w-md p-6 sm:p-8 shadow-2xl border border-gray-100">
            <button
              onClick={() => setLeadModalOpen(false)}
              className="absolute top-4 right-4 w-8 h-8 rounded-full bg-gray-100 hover:bg-gray-200 text-gray-600 flex items-center justify-center transition-colors cursor-pointer"
            >
              <X className="w-4 h-4" />
            </button>

            {submitted ? (
              <div className="py-8 flex flex-col items-center text-center">
                <div className="w-12 h-12 rounded-full bg-orange-100 text-[#F26522] flex items-center justify-center mb-4">
                  <CheckCircle2 className="w-6 h-6 stroke-[2.5]" />
                </div>
                <h3 className="font-heading text-xl font-semibold text-gray-900 mb-2">
                  Заявка принята!
                </h3>
                <p className="text-sm text-gray-600 max-w-xs">
                  Мы подготовим тестовую выборку компаний из 2ГИС по вашей нише и свяжемся с вами в Telegram.
                </p>
              </div>
            ) : (
              <div>
                <span className="text-[11px] font-semibold tracking-wider uppercase text-[#F26522] bg-orange-50 px-2.5 py-1 rounded">
                  Тест-драйв Fracs
                </span>
                <h3 className="font-heading text-xl sm:text-2xl font-medium text-gray-900 mt-3 mb-2 leading-tight">
                  Получите 20 горячих лидов в вашей нише
                </h3>
                <p className="text-[13px] text-gray-600 mb-6 leading-relaxed">
                  Спарсим базу 2ГИС по вашему городу, отберем бизнесы без сайтов и покажем прямые контакты ЛПР.
                </p>

                <form onSubmit={handleLeadSubmit} className="space-y-4">
                  <div>
                    <label className="block text-[12px] font-medium text-gray-700 mb-1">
                      Ваша сфера или ниша
                    </label>
                    <input
                      type="text"
                      required
                      value={nicheValue}
                      onChange={(e) => setNicheValue(e.target.value)}
                      placeholder="Например: производство мебели, автосервисы, B2B опт"
                      className="w-full px-3.5 py-2.5 text-[14px] rounded-xl border border-gray-200 focus:outline-none focus:border-[#F26522] transition-colors"
                    />
                  </div>

                  <div>
                    <label className="block text-[12px] font-medium text-gray-700 mb-1">
                      Telegram или номер телефона
                    </label>
                    <input
                      type="text"
                      required
                      value={contactValue}
                      onChange={(e) => setContactValue(e.target.value)}
                      placeholder="@username или +7 (999) 000-00-00"
                      className="w-full px-3.5 py-2.5 text-[14px] rounded-xl border border-gray-200 focus:outline-none focus:border-[#F26522] transition-colors"
                    />
                  </div>

                  <button
                    type="submit"
                    className="w-full mt-2 bg-[#F26522] hover:bg-[#e05a1a] text-white font-medium text-[14px] py-3 rounded-full transition-colors cursor-pointer flex items-center justify-center gap-2"
                  >
                    <span>Запустить бесплатный парсинг</span>
                    <ArrowRight className="w-4 h-4" />
                  </button>

                  <p className="text-[11px] text-gray-400 text-center mt-2">
                    Без спама. Никаких предоплат до согласования тестовой базы.
                  </p>
                </form>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
