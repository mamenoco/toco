<footer class="site-footer">
    <div class="footer-wave"></div>
    <img class="footer-rabbit left" src="<?php echo toco_asset('rabbit-botanical.png'); ?>" alt="">
    <nav aria-label="フッターメニュー">
        <?php wp_nav_menu(array('theme_location' => 'footer', 'container' => false, 'fallback_cb' => 'toco_primary_menu_fallback')); ?>
    </nav>
    <p>© <?php echo esc_html(wp_date('Y')); ?> tocoとくらし</p>
    <span class="footer-plant" aria-hidden="true"></span>
</footer>

<?php wp_footer(); ?>
</body>
</html>

