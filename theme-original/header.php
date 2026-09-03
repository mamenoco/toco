<!doctype html>
<html <?php language_attributes(); ?>>
<head>
    <meta charset="<?php bloginfo('charset'); ?>">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <?php wp_head(); ?>
</head>
<body <?php body_class(); ?>>
<?php wp_body_open(); ?>

<header class="site-header">
    <div class="header-main page-width">
        <div class="brand-wrap">
            <small>うさぎとの毎日を、もっと心地よく。</small>
            <a class="brand" href="<?php echo esc_url(home_url('/')); ?>">
                <span>tocoとくらし</span>
                <img src="<?php echo toco_asset('rabbit-botanical.png'); ?>" alt="うさぎと草花のイラスト">
            </a>
        </div>
        <div class="header-tools">
            <button class="mobile-menu" type="button" aria-label="メニューを開く" aria-controls="mobile-navigation" aria-expanded="false">
                <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M4 12h16M4 17h16"/></svg>
            </button>
            <button class="search-pill" type="button" aria-label="検索を開く" aria-controls="site-search" aria-expanded="false">
                <span>キーワードで検索</span>
                <i><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="6.5"/><path d="m16 16 4 4"/></svg></i>
            </button>
        </div>
    </div>
    <nav class="main-nav" aria-label="メインメニュー">
        <div class="page-width nav-inner">
            <?php wp_nav_menu(array('theme_location' => 'primary', 'container' => false, 'fallback_cb' => 'toco_primary_menu_fallback')); ?>
        </div>
    </nav>
    <div class="search-drawer" id="site-search" hidden>
        <div class="page-width">
            <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="6.5"/><path d="m16 16 4 4"/></svg>
            <?php get_search_form(); ?>
            <button class="search-close" type="button" aria-label="検索を閉じる">×</button>
        </div>
    </div>
</header>

<div class="menu-overlay" hidden></div>
<aside class="mobile-nav-sheet" id="mobile-navigation" aria-label="スマートフォンメニュー" aria-hidden="true">
    <button class="mobile-menu-close" type="button" aria-label="メニューを閉じる">×</button>
    <?php wp_nav_menu(array('theme_location' => 'primary', 'container' => 'nav', 'fallback_cb' => 'toco_primary_menu_fallback')); ?>
</aside>

