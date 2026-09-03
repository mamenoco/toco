<?php
if (!defined('ABSPATH')) {
    exit;
}

function toco_kurashi_setup() {
    add_theme_support('title-tag');
    add_theme_support('post-thumbnails');
    add_theme_support('custom-logo');
    add_theme_support('html5', array('search-form', 'gallery', 'caption', 'style', 'script'));
    add_image_size('toco-card', 720, 460, true);

    register_nav_menus(array(
        'primary' => 'メインメニュー',
        'footer'  => 'フッターメニュー',
    ));
}
add_action('after_setup_theme', 'toco_kurashi_setup');

function toco_kurashi_assets() {
    $version = wp_get_theme()->get('Version');
    wp_enqueue_style(
        'toco-fonts',
        'https://fonts.googleapis.com/css2?family=Noto+Sans+JP:wght@400;500;600;700&family=Zen+Maru+Gothic:wght@400;500;700&display=swap',
        array(),
        null
    );
    wp_enqueue_style('toco-theme', get_template_directory_uri() . '/assets/css/theme.css', array('toco-fonts'), $version);
    wp_enqueue_script('toco-theme', get_template_directory_uri() . '/assets/js/theme.js', array(), $version, true);
}
add_action('wp_enqueue_scripts', 'toco_kurashi_assets');

function toco_asset($filename) {
    return esc_url(get_template_directory_uri() . '/assets/images/' . ltrim($filename, '/'));
}

function toco_category_url($slug) {
    $category = get_category_by_slug($slug);
    return $category ? get_category_link($category->term_id) : home_url('/');
}

function toco_post_image($post_id, $size = 'toco-card') {
    $image = get_the_post_thumbnail_url($post_id, $size);
    return $image ? esc_url($image) : toco_asset('hero-rabbit-photo.png');
}

function toco_primary_menu_fallback() {
    $items = array(
        array('ホーム', home_url('/')),
        array('はじめての方へ', home_url('/#beginner')),
        array('カテゴリから探す', home_url('/#categories')),
        array('コラム', home_url('/#column')),
        array('おすすめ商品', home_url('/#pickup')),
        array('お問い合わせ', home_url('/contact/')),
    );

    echo '<ul class="menu">';
    foreach ($items as $item) {
        printf('<li><a href="%s">%s</a></li>', esc_url($item[1]), esc_html($item[0]));
    }
    echo '</ul>';
}

function toco_excerpt($post_id, $length = 62) {
    $text = get_the_excerpt($post_id);
    if (!$text) {
        $text = wp_strip_all_tags(get_post_field('post_content', $post_id));
    }
    return wp_trim_words($text, $length, '…');
}

