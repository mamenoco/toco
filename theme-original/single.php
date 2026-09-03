<?php get_header(); ?>
<main class="single-main">
    <?php while (have_posts()) : the_post(); $post_categories = get_the_category(); ?>
        <article <?php post_class('single-article page-width'); ?>>
            <header class="single-header">
                <?php if ($post_categories) : ?><a class="single-category" href="<?php echo esc_url(get_category_link($post_categories[0]->term_id)); ?>"><?php echo esc_html($post_categories[0]->name); ?></a><?php endif; ?>
                <h1><?php the_title(); ?></h1>
                <time datetime="<?php echo esc_attr(get_the_date('c')); ?>"><?php echo esc_html(get_the_date('Y.m.d')); ?></time>
            </header>
            <?php if (has_post_thumbnail()) : ?><figure class="single-hero"><?php the_post_thumbnail('large'); ?></figure><?php endif; ?>
            <div class="entry-content"><?php the_content(); ?></div>
            <nav class="post-navigation" aria-label="記事ナビゲーション"><?php the_post_navigation(array('prev_text' => '‹ %title', 'next_text' => '%title ›')); ?></nav>
        </article>
    <?php endwhile; ?>
</main>
<?php get_footer(); ?>

