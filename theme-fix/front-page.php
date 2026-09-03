<?php
get_header();

$categories = array(
    array('えさ・牧草', 'food', '主食からおやつまで<br>選び方やおすすめを紹介'),
    array('ケージ・サークル', 'house', 'おうち選びのポイントや<br>人気アイテムを紹介'),
    array('おもちゃ・用品', 'toy', '遊びや運動をサポートする<br>アイテムを紹介'),
    array('お手入れ・健康', 'care', '日々のケアや健康管理の<br>ヒントを紹介'),
    array('しつけ・暮らし', 'life', '快適に暮らすための<br>コツや工夫を紹介'),
);

$pickup_posts = get_posts(array('numberposts' => 5, 'post_status' => 'publish'));
$column_posts = get_posts(array('numberposts' => 3, 'post_status' => 'publish', 'category_name' => 'column'));
?>

<main>
    <section class="hero page-width" id="top">
        <div class="hero-photo"><img src="<?php echo toco_asset('hero-rabbit-photo.png'); ?>" alt="かごやおもちゃのそばでくつろぐ茶色いうさぎ"></div>
        <div class="hero-message">
            <p class="hero-title">うさぎとの毎日を<br><strong>もっと</strong> 心地よく。</p>
            <p class="hero-description">うさぎのごはんやおうち、おもちゃなど<br>暮らしに役立つ情報やアイテムを<br>やさしい視点でご紹介します。</p>
            <a class="pink-button" href="#beginner">はじめての方へ <span>›</span></a>
            <img class="hero-rabbit" src="<?php echo toco_asset('rabbit-botanical.png'); ?>" alt="草花と一緒に座るうさぎのイラスト">
        </div>
    </section>
    <div class="slider-dots" aria-hidden="true"><span class="active"></span><span></span><span></span></div>

    <section class="category-section page-width" id="categories">
        <div class="decor-heading"><span class="category-heading-art category-flower" aria-hidden="true"></span><h2>カテゴリから探す</h2><span class="category-heading-art category-sprig" aria-hidden="true"></span></div>
        <div class="category-grid">
            <?php foreach ($categories as $index => $category) : ?>
                <a class="category-card card-<?php echo esc_attr($index + 1); ?>" href="<?php echo esc_url(toco_category_url($category[1])); ?>">
                    <span class="category-art category-art-<?php echo esc_attr($index + 1); ?>" aria-hidden="true"></span>
                    <strong><?php echo esc_html($category[0]); ?></strong>
                    <small><?php echo wp_kses($category[2], array('br' => array())); ?></small>
                </a>
            <?php endforeach; ?>
        </div>
    </section>

    <section class="pickup-section" id="pickup"><div class="page-width">
        <div class="center-heading"><span class="heading-flora flora-left" aria-hidden="true"></span><h2>ピックアップ記事</h2><span class="heading-flora pickup-flora-right" aria-hidden="true"></span></div>
        <div class="pickup-grid">
            <?php if ($pickup_posts) : foreach ($pickup_posts as $post) : setup_postdata($post); $post_categories = get_the_category(); ?>
                <article class="pickup-card">
                    <a class="pickup-image" href="<?php the_permalink(); ?>"><img src="<?php echo toco_post_image(get_the_ID()); ?>" alt=""><span><?php echo esc_html($post_categories ? $post_categories[0]->name : 'うさぎの暮らし'); ?></span></a>
                    <h3><a href="<?php the_permalink(); ?>"><?php the_title(); ?></a></h3>
                    <time datetime="<?php echo esc_attr(get_the_date('c')); ?>"><?php echo esc_html(get_the_date('Y.m.d')); ?></time>
                </article>
            <?php endforeach; wp_reset_postdata(); else : ?>
                <p class="empty-message">記事を準備しています。</p>
            <?php endif; ?>
        </div>
    </div></section>

    <section class="lower-section page-width" id="column">
        <div class="column-box">
            <div class="box-heading"><img class="pencil-original" src="<?php echo toco_asset('pencil-original.png'); ?>" alt=""><h2>コラム</h2><span class="heading-flora flora-right" aria-hidden="true"></span></div>
            <div class="column-list">
                <?php if ($column_posts) : foreach ($column_posts as $post) : setup_postdata($post); ?>
                    <a class="column-row" href="<?php the_permalink(); ?>">
                        <img src="<?php echo toco_post_image(get_the_ID()); ?>" alt="">
                        <span><strong><?php the_title(); ?></strong><p><?php echo esc_html(toco_excerpt(get_the_ID(), 44)); ?></p><time datetime="<?php echo esc_attr(get_the_date('c')); ?>"><?php echo esc_html(get_the_date('Y.m.d')); ?></time></span><i>›</i>
                    </a>
                <?php endforeach; wp_reset_postdata(); else : ?>
                    <p class="empty-message">コラムを準備しています。</p>
                <?php endif; ?>
            </div>
            <a class="wide-pink-button" href="<?php echo esc_url(toco_category_url('column')); ?>">コラム一覧へ</a>
        </div>

        <aside class="sidebar">
            <section class="tag-box"><h2>人気のタグ</h2><div class="tags">
                <?php $tags = get_tags(array('number' => 8, 'orderby' => 'count', 'order' => 'DESC')); ?>
                <?php if ($tags) : foreach ($tags as $tag) : ?><a href="<?php echo esc_url(get_tag_link($tag->term_id)); ?>">#<?php echo esc_html($tag->name); ?></a><?php endforeach; else : ?>
                    <?php foreach (array('牧草', 'ケージ選び', 'おもちゃ', 'うさぎの食事', 'ブラッシング', 'しつけ') as $tag) : ?><span>#<?php echo esc_html($tag); ?></span><?php endforeach; ?>
                <?php endif; ?>
            </div></section>
            <section class="beginner-box" id="beginner"><div><p><span class="mini-flora" aria-hidden="true"></span>はじめての方へ</p><small>うさぎとの暮らしがもっと楽しくなる<br>基本情報や準備のポイントを<br>わかりやすくまとめています。</small><a href="<?php echo esc_url(home_url('/beginner/')); ?>">詳しく見る</a></div><img src="<?php echo toco_asset('rabbit-botanical.png'); ?>" alt="草花と一緒に座るうさぎのイラスト"></section>
            <section class="newsletter"><div><h2>メルマガ登録</h2><p>新着記事やおすすめ情報をお届けします。</p></div><svg class="mail-art" viewBox="0 0 48 38" aria-hidden="true"><path d="M4 5h40v28H4zM5 7l19 15L43 7"/></svg><form><label class="screen-reader-text" for="toco-email">メールアドレス</label><input id="toco-email" type="email" placeholder="メールアドレスを入力"><button type="button">登録する</button></form></section>
        </aside>
    </section>
</main>

<?php get_footer(); ?>
