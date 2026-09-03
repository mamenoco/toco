<?php get_header(); ?>
<main class="archive-main page-width">
    <header class="archive-header"><h1><?php echo is_search() ? '「' . esc_html(get_search_query()) . '」の検索結果' : esc_html(get_the_archive_title() ?: '記事一覧'); ?></h1></header>
    <div class="archive-grid">
        <?php if (have_posts()) : while (have_posts()) : the_post(); ?>
            <article class="archive-card"><a href="<?php the_permalink(); ?>"><img src="<?php echo toco_post_image(get_the_ID()); ?>" alt=""><div><time><?php echo esc_html(get_the_date('Y.m.d')); ?></time><h2><?php the_title(); ?></h2><p><?php echo esc_html(toco_excerpt(get_the_ID(), 36)); ?></p></div></a></article>
        <?php endwhile; else : ?><p>記事が見つかりませんでした。</p><?php endif; ?>
    </div>
    <?php the_posts_pagination(); ?>
</main>
<?php get_footer(); ?>

